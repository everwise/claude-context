import { describe, it, expect, beforeEach } from 'vitest';
import Parser from 'tree-sitter';
import { AstCodeSplitter } from '../ast-splitter';
import { CodeChunk } from '../index';

const { tsx: TSX } = require('tree-sitter-typescript');

describe('AST Splitter Unit Tests', () => {
  let splitter: AstCodeSplitter;

  beforeEach(() => {
    splitter = new AstCodeSplitter(512, 50);
  });

  describe('deduplicateChunks()', () => {
    it('should remove chunks with identical line ranges', () => {
      const duplicateChunks: CodeChunk[] = [
        {
          content: 'export function test() { return 42; }',
          metadata: { startLine: 10, endLine: 10, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'function test() { return 42; }',
          metadata: { startLine: 10, endLine: 10, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'const x = 5;',
          metadata: { startLine: 5, endLine: 5, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'import React from "react";',
          metadata: { startLine: 1, endLine: 1, language: 'tsx', filePath: 'test.tsx' }
        }
      ];

      // Access private method for unit testing
      const result = (splitter as any).deduplicateChunks(duplicateChunks);

      expect(result).toHaveLength(3);
      
      // Should keep first occurrence of each unique range
      expect(result[0].content).toBe('export function test() { return 42; }');
      expect(result[1].content).toBe('const x = 5;');
      expect(result[2].content).toBe('import React from "react";');
      
      // Verify no duplicate ranges
      const ranges = result.map((chunk: CodeChunk) => `${chunk.metadata.startLine}-${chunk.metadata.endLine}`);
      const uniqueRanges = new Set(ranges);
      expect(ranges.length).toBe(uniqueRanges.size);
    });

    it('should handle empty chunk array', () => {
      const result = (splitter as any).deduplicateChunks([]);
      expect(result).toEqual([]);
    });

    it('should handle single chunk', () => {
      const singleChunk: CodeChunk[] = [{
        content: 'test content',
        metadata: { startLine: 1, endLine: 1, language: 'tsx', filePath: 'test.tsx' }
      }];

      const result = (splitter as any).deduplicateChunks(singleChunk);
      expect(result).toEqual(singleChunk);
    });

    it('should handle no duplicates', () => {
      const uniqueChunks: CodeChunk[] = [
        {
          content: 'chunk 1',
          metadata: { startLine: 1, endLine: 1, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'chunk 2',
          metadata: { startLine: 2, endLine: 2, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'chunk 3',
          metadata: { startLine: 3, endLine: 3, language: 'tsx', filePath: 'test.tsx' }
        }
      ];

      const result = (splitter as any).deduplicateChunks(uniqueChunks);
      expect(result).toEqual(uniqueChunks);
    });

    it('should handle chunks spanning multiple lines', () => {
      const chunks: CodeChunk[] = [
        {
          content: 'function a() {\n  return 1;\n}',
          metadata: { startLine: 10, endLine: 12, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'export function a() {\n  return 1;\n}',
          metadata: { startLine: 10, endLine: 12, language: 'tsx', filePath: 'test.tsx' }
        },
        {
          content: 'const x = 5;\nconst y = 10;',
          metadata: { startLine: 5, endLine: 6, language: 'tsx', filePath: 'test.tsx' }
        }
      ];

      const result = (splitter as any).deduplicateChunks(chunks);
      expect(result).toHaveLength(2);
      expect(result[0].metadata.startLine).toBe(10);
      expect(result[0].metadata.endLine).toBe(12);
      expect(result[1].metadata.startLine).toBe(5);
      expect(result[1].metadata.endLine).toBe(6);
    });
  });

  describe('groupConsecutiveImports()', () => {
    it('should group consecutive imports from file start', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = `import React from 'react';
import { useState } from 'react';
import { Button } from '@chakra-ui/react';

const App = () => <div>Test</div>;`;

      const tree = parser.parse(code);
      
      // Access private method for unit testing
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).not.toBeNull();
      expect(result.chunk.content).toContain('import React from \'react\'');
      expect(result.chunk.content).toContain('import { useState } from \'react\'');
      expect(result.chunk.content).toContain('import { Button } from \'@chakra-ui/react\'');
      expect(result.chunk.metadata.startLine).toBe(1);
      expect(result.chunk.metadata.endLine).toBe(3);
      expect(result.processedNodes.size).toBe(3);
    });

    it('should stop grouping when hitting non-import code', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = `import React from 'react';
import { useState } from 'react';

const someVariable = 'stops import sequence';

import { Button } from '@chakra-ui/react';`;

      const tree = parser.parse(code);
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).not.toBeNull();
      expect(result.chunk.content).toContain('import React from \'react\'');
      expect(result.chunk.content).toContain('import { useState } from \'react\'');
      expect(result.chunk.content).not.toContain('import { Button }'); // Should be excluded
      expect(result.chunk.metadata.startLine).toBe(1);
      expect(result.chunk.metadata.endLine).toBe(2);
      expect(result.processedNodes.size).toBe(2);
    });

    it('should skip comments and whitespace between imports', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = `import React from 'react';
// This is a comment
import { useState } from 'react';

import { Button } from '@chakra-ui/react';

const App = () => <div>Test</div>;`;

      const tree = parser.parse(code);
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).not.toBeNull();
      expect(result.chunk.content).toContain('import React from \'react\'');
      expect(result.chunk.content).toContain('import { useState } from \'react\'');
      expect(result.chunk.content).toContain('import { Button } from \'@chakra-ui/react\'');
      expect(result.processedNodes.size).toBe(3);
    });

    it('should return null for single import', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = `import React from 'react';

const App = () => <div>Test</div>;`;

      const tree = parser.parse(code);
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).toBeNull();
      expect(result.processedNodes.size).toBe(0);
    });

    it('should return null when no imports at start', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = `const App = () => <div>Test</div>;
      
import React from 'react';`;

      const tree = parser.parse(code);
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).toBeNull();
      expect(result.processedNodes.size).toBe(0);
    });

    it('should handle empty file', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = '';
      const tree = parser.parse(code);
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).toBeNull();
      expect(result.processedNodes.size).toBe(0);
    });

    it('should handle imports with multi-line destructuring', () => {
      const parser = new Parser();
      parser.setLanguage(TSX);

      const code = `import React from 'react';
import {
  useState,
  useEffect,
  useCallback
} from 'react';
import { Button, Box } from '@chakra-ui/react';

const App = () => <div>Test</div>;`;

      const tree = parser.parse(code);
      const result = (splitter as any).groupConsecutiveImports(tree.rootNode, code, 'tsx', 'test.tsx');

      expect(result.chunk).not.toBeNull();
      expect(result.chunk.content).toContain('useState,');
      expect(result.chunk.content).toContain('useEffect,');
      expect(result.chunk.content).toContain('useCallback');
      expect(result.chunk.content).toContain('Button, Box');
      expect(result.processedNodes.size).toBe(3);
    });
  });

  describe('Integration: deduplication + import grouping', () => {
    it('should work together correctly', async () => {
      const code = `import React from 'react';
import { useState } from 'react';
import { Button } from '@chakra-ui/react';

interface Props {
  value: string;
}

export function Component({ value }: Props) {
  return <div>{value}</div>;
}`;

      const chunks = await splitter.split(code, 'tsx', 'test.tsx');

      // Should have grouped imports (1 chunk for all imports)
      const importChunks = chunks.filter(chunk => 
        chunk.content.includes('import React') && 
        chunk.content.includes('useState') && 
        chunk.content.includes('Button')
      );
      expect(importChunks).toHaveLength(1);

      // Should have no duplicate line ranges
      const ranges = chunks.map(chunk => `${chunk.metadata.startLine}-${chunk.metadata.endLine}`);
      const uniqueRanges = new Set(ranges);
      expect(ranges.length).toBe(uniqueRanges.size);

      // Should capture interface and export function separately
      const interfaceChunk = chunks.find(chunk => chunk.content.includes('interface Props'));
      const exportChunk = chunks.find(chunk => chunk.content.includes('export function Component'));
      
      expect(interfaceChunk).toBeDefined();
      expect(exportChunk).toBeDefined();
    });
  });
});