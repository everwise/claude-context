import { describe, it, expect, beforeEach } from 'vitest';
import { AstCodeSplitter } from '../ast-splitter';

describe('AST Splitter Regression Tests', () => {
  let astSplitter: AstCodeSplitter;

  beforeEach(() => {
    astSplitter = new AstCodeSplitter(512, 50);
  });

  describe('Language Detection Regressions', () => {
    it('should use tsx parser for .tsx files, not typescript parser', async () => {
      // This was the critical bug: .tsx files were mapped to 'typescript' instead of 'tsx'
      const tsxCode = `import React from 'react';

interface Props {
  name: string;
}

export function Component({ name }: Props) {
  return <div>Hello {name}</div>;
}`;

      const chunks = await astSplitter.split(tsxCode, 'tsx', 'test.tsx');
      
      // With tsx parser, we should capture interface and export function
      const interfaceChunk = chunks.find(chunk => chunk.content.includes('interface Props'));
      const exportChunk = chunks.find(chunk => chunk.content.includes('export function Component'));
      
      expect(interfaceChunk, 'tsx parser should capture interface declarations').toBeDefined();
      expect(exportChunk, 'tsx parser should capture export function declarations').toBeDefined();
      
      // Verify we get at least 3 meaningful chunks (typescript parser would have missed key structures)
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Import Grouping Regressions', () => {
    it('should group consecutive imports into single chunk', async () => {
      const codeWithMultipleImports = `import { useEffect, useMemo, useRef } from 'react';

import { Box, Button, Flex } from '@chakra-ui/react';

import { useAuth } from '@everwise/shared-util-auth-hook';
import { useLayout } from '@everwise/shared-util-page-layout';

import { Container } from '@everwise/matchbox';

import i18n from '../../../i18n';
import {
  ChatConnectionStatus,
  useBaseChatWebSocket,
} from '../utils/use-audio-chat';
import ChatHistory from './chat-history';

const t = i18n.t;

export function TestComponent() {
  return <div>Test</div>;
}`;

      const chunks = await astSplitter.split(codeWithMultipleImports, 'tsx', 'test.tsx');
      
      // Find the grouped imports chunk
      const importChunk = chunks.find(chunk => 
        chunk.content.includes('import { useEffect') && 
        chunk.content.includes('import ChatHistory') &&
        chunk.metadata.startLine === 1
      );
      
      expect(importChunk, 'should have a single chunk containing all consecutive imports').toBeDefined();
      
      // The import chunk should span from line 1 to approximately line 15
      expect(importChunk!.metadata.endLine).toBeGreaterThan(10);
      
      // Should NOT have 7+ separate import chunks
      const allImportChunks = chunks.filter(chunk => 
        chunk.content.trim().startsWith('import') && 
        chunk.content.split('\n').length <= 2
      );
      expect(allImportChunks.length, 'should not have multiple single-line import chunks').toBeLessThan(3);
    });

    it('should stop grouping imports when hitting non-import code', async () => {
      const codeWithMixedContent = `import React from 'react';
import { useState } from 'react';

const someVariable = 'breaks import sequence';

import { Button } from '@chakra-ui/react';  // This should be separate

export function Component() {
  return <div>Test</div>;
}`;

      const chunks = await astSplitter.split(codeWithMixedContent, 'tsx', 'test.tsx');
      
      // First two imports should be grouped
      const firstImportGroup = chunks.find(chunk => 
        chunk.content.includes('import React') && 
        chunk.content.includes('import { useState }') &&
        chunk.metadata.startLine === 1
      );
      expect(firstImportGroup).toBeDefined();
      
      // Later import should be separate (after variable declaration)
      const laterImport = chunks.find(chunk => 
        chunk.content.includes('import { Button }') &&
        chunk.metadata.startLine > 3
      );
      expect(laterImport).toBeDefined();
    });
  });

  describe('Deduplication Regressions', () => {
    it('should deduplicate chunks with identical line ranges', async () => {
      const codeWithPotentialDuplicates = `import React from 'react';

interface TestProps {
  value: string;
}

export function TestComponent({ value }: TestProps) {
  const result = useMemo(() => value.toUpperCase(), [value]);
  
  return <div>{result}</div>;
}`;

      const chunks = await astSplitter.split(codeWithPotentialDuplicates, 'tsx', 'test.tsx');
      
      // Check for duplicate line ranges (the bug was export_statement + function_declaration creating duplicates)
      const lineRanges = chunks.map(chunk => `${chunk.metadata.startLine}-${chunk.metadata.endLine}`);
      const uniqueRanges = new Set(lineRanges);
      
      expect(lineRanges.length, 'should not have duplicate line ranges').toBe(uniqueRanges.size);
      
      // Specifically check that we don't have duplicate export function chunks
      const exportFunctionChunks = chunks.filter(chunk => 
        chunk.content.includes('export function TestComponent') ||
        chunk.content.includes('function TestComponent')
      );
      
      // Should have exactly 1, not 2 (export_statement + function_declaration duplicate)
      expect(exportFunctionChunks.length, 'should have exactly one export function chunk, not duplicates').toBe(1);
    });
  });

  describe('Integration Regression - IntakeChat Pattern', () => {
    it('should properly chunk intake-chat.tsx pattern without regressions', async () => {
      // Simplified version of the actual intake-chat.tsx that caused issues
      const intakeChatPattern = `import { useEffect, useMemo, useRef } from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import { useAuth } from '@everwise/shared-util-auth-hook';
import { useLayout } from '@everwise/shared-util-page-layout';

const genAIServiceUrl = import.meta.env.VITE_GEN_AI_SERVICE_URL || 'https://gen-ai.dev.torch.io';

interface IntakeChatProps {
  signature: string;
  payload: string;
  onStatusChange?: (status: ChatConnectionStatus) => void;
}

export function IntakeChat({
  signature,
  payload,
  onStatusChange,
}: IntakeChatProps) {
  const { userId, loading } = useAuth();
  const { useFooter } = useLayout();

  const params = useMemo(
    () => ({
      signature,
      payload,
      ...(userId ? { user_id: userId.toString() } : {}),
    }),
    [signature, payload, userId]
  );

  return (
    <Flex>
      <div>Test</div>
    </Flex>
  );
}`;

      const chunks = await astSplitter.split(intakeChatPattern, 'tsx', 'intake-chat.tsx');
      
      // Verify all critical components are captured
      const hasImportChunk = chunks.some(chunk => 
        chunk.content.includes('import { useEffect') && chunk.content.includes('useLayout')
      );
      expect(hasImportChunk, 'should capture grouped imports').toBe(true);
      
      const hasInterfaceChunk = chunks.some(chunk => 
        chunk.content.includes('interface IntakeChatProps')
      );
      expect(hasInterfaceChunk, 'should capture interface declaration').toBe(true);
      
      const hasExportChunk = chunks.some(chunk => 
        chunk.content.includes('export function IntakeChat')
      );
      expect(hasExportChunk, 'should capture export function').toBe(true);
      
      // Should have reasonable number of chunks (not too many, not too few)
      expect(chunks.length).toBeGreaterThan(5);
      expect(chunks.length).toBeLessThan(25);
      
      console.log(`IntakeChat pattern test: ${chunks.length} chunks generated`);
    });
  });
});