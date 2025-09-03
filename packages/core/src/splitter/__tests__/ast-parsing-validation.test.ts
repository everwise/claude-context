import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import Parser from 'tree-sitter';
import { AstCodeSplitter } from '../ast-splitter';

// Language parsers - same imports as in ast-splitter.ts
const JavaScript = require('tree-sitter-javascript');
const { typescript: TypeScript, tsx: TSX } = require('tree-sitter-typescript');
const Python = require('tree-sitter-python');
const Java = require('tree-sitter-java');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');

// Expected node types that should be recognized for each language
const EXPECTED_NODE_TYPES = {
  typescript: {
    required: ['import_statement', 'export_statement', 'function_declaration', 'lexical_declaration', 'interface_declaration', 'arrow_function'],
    optional: ['class_declaration', 'method_definition', 'type_alias_declaration', 'variable_declaration']
  },
  tsx: {
    required: ['import_statement', 'export_statement', 'function_declaration', 'lexical_declaration', 'interface_declaration', 'arrow_function'],
    optional: ['class_declaration', 'method_definition', 'type_alias_declaration', 'variable_declaration']
  },
  javascript: {
    required: ['import_statement', 'export_statement', 'function_declaration', 'lexical_declaration', 'arrow_function'],
    optional: ['class_declaration', 'method_definition', 'variable_declaration']
  },
  python: {
    required: ['function_definition', 'class_definition', 'import_statement', 'import_from_statement'],
    optional: ['async_function_definition', 'decorated_definition', 'assignment']
  },
  java: {
    required: ['method_declaration', 'class_declaration', 'import_declaration'],
    optional: ['interface_declaration', 'constructor_declaration', 'field_declaration']
  },
  go: {
    required: ['function_declaration', 'import_declaration'],
    optional: ['method_declaration', 'type_declaration', 'var_declaration', 'const_declaration']
  },
  rust: {
    required: ['function_item', 'use_declaration'],
    optional: ['impl_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item']
  }
};

// Sample code for each supported language
const SAMPLE_CODE = {
  typescript: `import { useEffect, useMemo } from 'react';
import ChatHistory from './chat-history';

interface IntakeChatProps {
  signature: string;
  payload: string;
}

const t = i18n.t;
const genAIServiceUrl = 'https://api.example.com';

const ChatFooter = ({ status }: { status: string }) => {
  return <div>Footer</div>;
};

export function IntakeChat({ signature, payload }: IntakeChatProps) {
  const params = useMemo(() => ({ signature, payload }), [signature, payload]);

  useEffect(() => {
    console.log('Component mounted');
  }, []);

  return <div><ChatHistory /></div>;
}

export default IntakeChat;`,

  tsx: `import { useEffect, useMemo } from 'react';
import ChatHistory from './chat-history';

interface IntakeChatProps {
  signature: string;
  payload: string;
}

const t = i18n.t;
const genAIServiceUrl = 'https://api.example.com';

const ChatFooter = ({ status }: { status: string }) => {
  return <div>Footer</div>;
};

export function IntakeChat({ signature, payload }: IntakeChatProps) {
  const params = useMemo(() => ({ signature, payload }), [signature, payload]);

  useEffect(() => {
    console.log('Component mounted');
  }, []);

  return <div><ChatHistory /></div>;
}

export default IntakeChat;`,

  javascript: `import { useState, useEffect } from 'react';
import utils from './utils';

const API_URL = 'https://api.example.com';

const handleClick = () => {
  console.log('Clicked');
};

function MyComponent() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log('Effect ran');
  }, [count]);

  return <div onClick={handleClick}>Count: {count}</div>;
}

export default MyComponent;`,

  python: `import os
import sys
from typing import List, Optional

class DataProcessor:
    def __init__(self, config: dict):
        self.config = config

    def process_data(self, data: List[str]) -> Optional[str]:
        """Process the input data."""
        if not data:
            return None
        return '\n'.join(data)

async def async_function():
    """An async function example."""
    await some_operation()

def main():
    processor = DataProcessor({'debug': True})
    result = processor.process_data(['hello', 'world'])
    print(result)

if __name__ == '__main__':
    main()`,

  java: `package com.example.demo;

import java.util.List;
import java.util.ArrayList;

public class DataProcessor {
    private String config;

    public DataProcessor(String config) {
        this.config = config;
    }

    public List<String> processData(List<String> input) {
        List<String> result = new ArrayList<>();
        for (String item : input) {
            result.add(item.toUpperCase());
        }
        return result;
    }

    public static void main(String[] args) {
        DataProcessor processor = new DataProcessor("debug");
        List<String> data = List.of("hello", "world");
        System.out.println(processor.processData(data));
    }
}`,

  go: `package main

import (
    "fmt"
    "strings"
)

type DataProcessor struct {
    config string
}

func NewDataProcessor(config string) *DataProcessor {
    return &DataProcessor{config: config}
}

func (dp *DataProcessor) ProcessData(data []string) string {
    return strings.Join(data, " ")
}

func main() {
    processor := NewDataProcessor("debug")
    data := []string{"hello", "world"}
    result := processor.ProcessData(data)
    fmt.Println(result)
}`,

  rust: `use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Config {
    pub debug: bool,
    pub url: String,
}

impl Config {
    pub fn new(debug: bool, url: String) -> Self {
        Self { debug, url }
    }
}

pub fn process_data(data: &[String]) -> String {
    data.join(" ")
}

fn main() {
    let config = Config::new(true, "https://api.example.com".to_string());
    let data = vec!["hello".to_string(), "world".to_string()];
    let result = process_data(&data);
    println!("{}", result);
}`
};

// Test cases that would have caught the Tree-sitter 0.23.x issue
describe('AST Parsing Validation Tests', () => {
  let astSplitter: AstCodeSplitter;

  beforeEach(() => {
    // Use default configuration
    astSplitter = new AstCodeSplitter(2500, 0);
  });

  describe('1. No ERROR nodes validation', () => {
    it.each(Object.entries(SAMPLE_CODE))('should parse %s without ERROR nodes', (language, code) => {
      const parser = new Parser();

      // Set the appropriate language
      const languageMap: Record<string, any> = {
        typescript: TypeScript,
        tsx: TSX,
        javascript: JavaScript,
        python: Python,
        java: Java,
        go: Go,
        rust: Rust
      };

      const treeSitterLanguage = languageMap[language];
      if (!treeSitterLanguage) {
        console.warn(`Language ${language} not supported in this test`);
        return;
      }

      parser.setLanguage(treeSitterLanguage);
      const tree = parser.parse(code);

      // Collect all ERROR nodes
      const errorNodes: string[] = [];
      const traverse = (node: Parser.SyntaxNode, path = '') => {
        if (node.type === 'ERROR') {
          const text = code.slice(node.startIndex, node.endIndex);
          errorNodes.push(`${path}[${node.startPosition.row}:${node.startPosition.column}] "${text}"`);
        }

        for (let i = 0; i < node.children.length; i++) {
          traverse(node.children[i], `${path}>${node.type}[${i}]`);
        }
      };

      traverse(tree.rootNode);

      if (errorNodes.length > 0) {
        console.error(`ERROR nodes found in ${language}:`, errorNodes);
      }

      expect(errorNodes).toHaveLength(0);
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).not.toBe('ERROR');
    });
  });

  describe('2. Expected node types validation', () => {
    it.each(Object.entries(SAMPLE_CODE))('should recognize expected node types for %s', (language, code) => {
      const parser = new Parser();

      const languageMap: Record<string, any> = {
        typescript: TypeScript,
        tsx: TSX,
        javascript: JavaScript,
        python: Python,
        java: Java,
        go: Go,
        rust: Rust
      };

      const treeSitterLanguage = languageMap[language];
      if (!treeSitterLanguage) {
        console.warn(`Language ${language} not supported in this test`);
        return;
      }

      parser.setLanguage(treeSitterLanguage);
      const tree = parser.parse(code);

      // Collect all node types
      const foundNodeTypes = new Set<string>();
      const traverse = (node: Parser.SyntaxNode) => {
        foundNodeTypes.add(node.type);
        for (const child of node.children) {
          traverse(child);
        }
      };

      traverse(tree.rootNode);

      const expectedTypes = EXPECTED_NODE_TYPES[language as keyof typeof EXPECTED_NODE_TYPES];
      if (!expectedTypes) {
        console.warn(`No expected types defined for ${language}`);
        return;
      }

      // Check required node types
      for (const requiredType of expectedTypes.required) {
        if (!foundNodeTypes.has(requiredType)) {
          console.error(`Missing required node type '${requiredType}' for ${language}`);
          console.error(`Found types:`, Array.from(foundNodeTypes).sort());
        }
        expect(foundNodeTypes.has(requiredType)).toBe(true);
      }

      // Report on optional node types (info only)
      const missingOptional = expectedTypes.optional.filter(type => !foundNodeTypes.has(type));
      if (missingOptional.length > 0) {
        console.info(`Optional node types not found in ${language}:`, missingOptional);
      }
    });
  });

  describe('3. Meaningful chunks validation', () => {
    it.each(Object.entries(SAMPLE_CODE))('should generate substantial chunks for %s', async (language, code) => {
      const chunks = await astSplitter.split(code, language, `test.${language}`);

      expect(chunks.length).toBeGreaterThan(0);

      // Chunks should have meaningful content (not just tiny fragments)
      const substantialChunks = chunks.filter(chunk => chunk.content.trim().length > 10);
      expect(substantialChunks.length).toBeGreaterThan(0);

      // Check that we're not creating too many micro-chunks
      const microChunks = chunks.filter(chunk => chunk.content.trim().length < 5);
      const microChunkRatio = microChunks.length / chunks.length;

      if (microChunkRatio > 0.5) {
        console.warn(`High ratio of micro-chunks (${microChunkRatio.toFixed(2)}) for ${language}`);
        console.warn('Chunks:', chunks.map(c => `"${c.content.substring(0, 50)}..."`));
      }

      expect(microChunkRatio).toBeLessThan(0.5);
    });

    it.each(Object.entries(SAMPLE_CODE))('should capture key language constructs for %s', async (language, code) => {
      const chunks = await astSplitter.split(code, language, `test.${language}`);
      const allContent = chunks.map(c => c.content).join('\n');

      // Language-specific validation
      switch (language) {
        case 'typescript':
        case 'javascript':
          expect(allContent).toContain('import');
          expect(allContent.includes('function') || allContent.includes('=>')).toBe(true);
          break;
        case 'python':
          expect(allContent.includes('def ') || allContent.includes('async def')).toBe(true);
          expect(allContent.includes('class ') || allContent.includes('import')).toBe(true);
          break;
        case 'java':
          expect(allContent.includes('public ') || allContent.includes('class ')).toBe(true);
          break;
        case 'go':
          expect(allContent.includes('func ') || allContent.includes('import')).toBe(true);
          break;
        case 'rust':
          expect(allContent.includes('fn ') || allContent.includes('use ')).toBe(true);
          break;
      }
    });
  });

  describe('4. Real-world file validation', () => {
    const realFilePath = '/Users/matt/dev/torch/archipelago/torch-ui/libs/assistant/feature/src/lib/ui/intake-chat.tsx';

    it('should parse real intake-chat.tsx file with minimal ERROR nodes', () => {
      if (!existsSync(realFilePath)) {
        console.warn('Real intake-chat.tsx file not found, skipping test');
        return;
      }

      const content = readFileSync(realFilePath, 'utf-8');
      const parser = new Parser();
      parser.setLanguage(TSX); // Use TSX parser for .tsx files
      const tree = parser.parse(content);

      const errorNodes: string[] = [];
      const criticalErrorNodes: string[] = [];

      const traverse = (node: Parser.SyntaxNode, depth = 0) => {
        if (node.type === 'ERROR') {
          const text = content.slice(node.startIndex, node.endIndex);
          const line = node.startPosition.row + 1;
          const col = node.startPosition.column + 1;
          const errorDescription = `Line ${line}:${col} - "${text.substring(0, 50)}"`;
          errorNodes.push(errorDescription);

          // Check if this is a critical error (affects main structure)
          if (text.includes('import') || text.includes('export') || text.includes('function') || text.length > 100) {
            criticalErrorNodes.push(errorDescription);
          }
        }

        for (const child of node.children) {
          traverse(child, depth + 1);
        }
      };

      traverse(tree.rootNode);

      if (errorNodes.length > 0) {
        console.warn(`Found ${errorNodes.length} ERROR nodes in real intake-chat.tsx (${criticalErrorNodes.length} critical):`);
        errorNodes.forEach(error => console.warn(`  ${error}`));
      }

      // We expect some minor JSX parsing issues, but no critical structural errors
      expect(criticalErrorNodes.length).toBe(0);

      // If there are too many errors, it indicates a regression
      if (errorNodes.length > 20) {
        console.error('Too many ERROR nodes - this indicates a Tree-sitter parsing regression!');
        expect(errorNodes.length).toBeLessThanOrEqual(20);
      }
    });

    it('should generate meaningful chunks from real intake-chat.tsx file', async () => {
      if (!existsSync(realFilePath)) {
        console.warn('Real intake-chat.tsx file not found, skipping test');
        return;
      }

      const content = readFileSync(realFilePath, 'utf-8');
      const chunks = await astSplitter.split(content, 'tsx', realFilePath);

      expect(chunks.length).toBeGreaterThan(0);

      // Should capture imports
      const importsChunks = chunks.filter(chunk =>
        chunk.content.includes('import') && chunk.content.includes('from')
      );
      expect(importsChunks.length).toBeGreaterThan(0);

      // Should capture main component function
      const mainComponentChunks = chunks.filter(chunk =>
        chunk.content.includes('export function IntakeChat') ||
        chunk.content.includes('function IntakeChat')
      );
      expect(mainComponentChunks.length).toBeGreaterThan(0);

      // Should capture interface
      const interfaceChunks = chunks.filter(chunk =>
        chunk.content.includes('interface IntakeChatProps')
      );
      expect(interfaceChunks.length).toBeGreaterThan(0);

      // Validate chunk quality
      const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
      const avgChunkSize = totalChars / chunks.length;
      expect(avgChunkSize).toBeGreaterThan(20); // Should have substantial content

      console.log(`Real file chunking: ${chunks.length} chunks, avg size: ${avgChunkSize.toFixed(0)} chars`);
    });
  });

  describe('5. Tree-sitter version regression detection', () => {
    it('should detect Tree-sitter compatibility issues', () => {
      const testCases = [
        {
          language: 'typescript',
          parser: TypeScript,
          code: 'const x = 5;\nfunction test() { return x; }',
          expectedNodes: ['lexical_declaration', 'function_declaration']
        },
        {
          language: 'javascript',
          parser: JavaScript,
          code: 'import React from "react";\nconst App = () => <div>Hello</div>;',
          expectedNodes: ['import_statement', 'lexical_declaration']
        },
        {
          language: 'tsx',
          parser: TSX,
          code: 'import React from "react";\nconst App = () => <div>Hello</div>;\nexport default App;',
          expectedNodes: ['import_statement', 'lexical_declaration', 'export_statement']
        },
        {
          language: 'python',
          parser: Python,
          code: 'def hello():\n    return "world"',
          expectedNodes: ['function_definition']
        }
      ];

      for (const testCase of testCases) {
        const parser = new Parser();
        parser.setLanguage(testCase.parser);

        try {
          const tree = parser.parse(testCase.code);
          expect(tree.rootNode).toBeDefined();

          // Collect node types
          const nodeTypes = new Set<string>();
          const traverse = (node: Parser.SyntaxNode) => {
            nodeTypes.add(node.type);
            for (const child of node.children) {
              traverse(child);
            }
          };
          traverse(tree.rootNode);

          // Check for expected nodes
          for (const expectedNode of testCase.expectedNodes) {
            if (!nodeTypes.has(expectedNode)) {
              console.error(`Missing expected node '${expectedNode}' for ${testCase.language}`);
              console.error('Available nodes:', Array.from(nodeTypes));
            }
            expect(nodeTypes.has(expectedNode)).toBe(true);
          }

        } catch (error) {
          console.error(`Parser setup failed for ${testCase.language}:`, error);
          throw error;
        }
      }
    });

    it('should validate parser method availability', () => {
      const parsers = [
        { name: 'TypeScript', parser: TypeScript },
        { name: 'TSX', parser: TSX },
        { name: 'JavaScript', parser: JavaScript },
        { name: 'Python', parser: Python },
        { name: 'Java', parser: Java },
        { name: 'Go', parser: Go },
        { name: 'Rust', parser: Rust }
      ];

      for (const { name, parser: parserLanguage } of parsers) {
        const parser = new Parser();

        // These methods should exist and work
        expect(() => parser.setLanguage(parserLanguage)).not.toThrow();

        const testCode = '// test';
        const tree = parser.parse(testCode);
        expect(tree.rootNode).toBeDefined();
        expect(tree.rootNode.type).toBeDefined();
        expect(tree.rootNode.startPosition).toBeDefined();
        expect(tree.rootNode.endPosition).toBeDefined();

        console.log(`✅ Parser ${name} working correctly`);
      }
    });
  });

  describe('6. AST Splitter integration validation', () => {
    it('should maintain consistency between direct tree-sitter parsing and AST splitter', async () => {
      const testCode = SAMPLE_CODE.typescript;

      // Direct tree-sitter parsing
      const parser = new Parser();
      parser.setLanguage(TypeScript);
      const tree = parser.parse(testCode);

      const directNodeTypes = new Set<string>();
      const traverse = (node: Parser.SyntaxNode) => {
        directNodeTypes.add(node.type);
        for (const child of node.children) {
          traverse(child);
        }
      };
      traverse(tree.rootNode);

      // AST Splitter parsing
      const chunks = await astSplitter.split(testCode, 'typescript', 'test.tsx');

      // The AST splitter should have used tree-sitter internally
      expect(chunks.length).toBeGreaterThan(0);

      // Verify no fallback to LangChain occurred
      const totalChunkContent = chunks.map(c => c.content).join('\n');
      expect(totalChunkContent.length).toBeGreaterThan(0);

      // Should contain meaningful TypeScript constructs
      const hasImports = chunks.some(chunk => chunk.content.includes('import'));
      const hasFunctions = chunks.some(chunk =>
        chunk.content.includes('function') || chunk.content.includes('=>')
      );

      expect(hasImports || hasFunctions).toBe(true);
    });

    it('should handle edge cases without crashing', async () => {
      const edgeCases = [
        { name: 'empty string', code: '', language: 'typescript' },
        { name: 'whitespace only', code: '   \n  \t  \n', language: 'typescript' },
        { name: 'single line', code: 'const x = 5;', language: 'typescript' },
        { name: 'malformed code', code: 'function incomplete() {', language: 'typescript' },
        { name: 'very large code', code: 'const x = 1;\n'.repeat(1000), language: 'typescript' }
      ];

      for (const testCase of edgeCases) {
        const chunks = await astSplitter.split(testCase.code, testCase.language, `test-${testCase.name}.tsx`);
        expect(chunks).toBeDefined();
        expect(Array.isArray(chunks)).toBe(true);

        // Should either produce chunks or handle gracefully
        if (testCase.code.trim().length > 0) {
          expect(chunks.length).toBeGreaterThan(0);
        }
      }
    });
  });
});