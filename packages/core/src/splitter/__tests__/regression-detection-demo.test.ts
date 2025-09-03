import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';

/**
 * Demonstration test showing how the new AST parsing validation tests 
 * would catch a Tree-sitter version regression like the 0.23.x upgrade issue.
 * 
 * This test simulates what would happen if Tree-sitter parsers suddenly
 * stopped working properly due to version incompatibilities.
 */
describe('Regression Detection Demo', () => {
  it('should demonstrate how validation tests catch Tree-sitter regressions', () => {
    const { typescript: TypeScript, tsx: TSX } = require('tree-sitter-typescript');
    
    // Test 1: Parser should be available and functional
    expect(TypeScript).toBeDefined();
    expect(TSX).toBeDefined();
    
    // Test 2: Parser should be able to parse without throwing
    const parser = new Parser();
    expect(() => parser.setLanguage(TypeScript)).not.toThrow();
    expect(() => parser.setLanguage(TSX)).not.toThrow();
    
    // Test 3: Basic parsing should work
    const simpleCode = 'const x = 5;';
    const tree = parser.parse(simpleCode);
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe('program');
    
    // Test 4: Should recognize expected node types
    const codeWithLexicalDeclaration = 'const greeting = "hello world";';
    const treeWithDecl = parser.parse(codeWithLexicalDeclaration);
    
    let foundLexicalDeclaration = false;
    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'lexical_declaration') {
        foundLexicalDeclaration = true;
      }
      for (const child of node.children) {
        traverse(child);
      }
    };
    
    traverse(treeWithDecl.rootNode);
    expect(foundLexicalDeclaration).toBe(true);
    
    console.log('✅ All regression checks passed - Tree-sitter is working correctly');
  });

  it('should show what would fail during a parser regression', () => {
    // This test documents the types of failures we'd expect to see
    // if Tree-sitter parsers were broken or incompatible
    
    const regressionScenarios = [
      {
        name: 'Parser availability',
        test: () => {
          const parsers = require('tree-sitter-typescript');
          expect(parsers.typescript).toBeDefined();
          expect(parsers.tsx).toBeDefined();
        }
      },
      {
        name: 'Parser functionality',
        test: () => {
          const parser = new Parser();
          const { typescript: TypeScript } = require('tree-sitter-typescript');
          expect(() => parser.setLanguage(TypeScript)).not.toThrow();
        }
      },
      {
        name: 'Basic parsing capability',
        test: () => {
          const parser = new Parser();
          const { typescript: TypeScript } = require('tree-sitter-typescript');
          parser.setLanguage(TypeScript);
          
          const tree = parser.parse('const x = 5;');
          expect(tree.rootNode).toBeDefined();
          expect(tree.rootNode.type).not.toBe('ERROR');
        }
      },
      {
        name: 'Node type recognition',
        test: () => {
          const parser = new Parser();
          const { typescript: TypeScript } = require('tree-sitter-typescript');
          parser.setLanguage(TypeScript);
          
          const tree = parser.parse('function test() { return 42; }');
          
          let foundFunction = false;
          const traverse = (node: Parser.SyntaxNode) => {
            if (node.type === 'function_declaration') {
              foundFunction = true;
            }
            for (const child of node.children) {
              traverse(child);
            }
          };
          
          traverse(tree.rootNode);
          expect(foundFunction).toBe(true);
        }
      }
    ];

    // Run all regression scenario checks
    regressionScenarios.forEach(scenario => {
      console.log(`Checking: ${scenario.name}`);
      expect(() => scenario.test()).not.toThrow();
    });

    console.log('✅ All regression scenarios passed - parsers are stable');
  });

  it('should validate that AST splitter enhancement works correctly', async () => {
    const { AstCodeSplitter } = await import('../ast-splitter');
    
    // Verify TSX support was added correctly
    const supportedLanguages = AstCodeSplitter.getSupportedLanguages();
    expect(supportedLanguages).toContain('tsx');
    
    // Verify TSX parser works with real JSX code
    const splitter = new AstCodeSplitter();
    const jsxCode = `
import React from 'react';

const MyComponent = () => {
  return <div>Hello World</div>;
};

export default MyComponent;
    `.trim();

    const chunks = await splitter.split(jsxCode, 'tsx', 'test.tsx');
    
    // Should generate meaningful chunks
    expect(chunks.length).toBeGreaterThan(0);
    
    // Should capture imports
    const hasImports = chunks.some(chunk => chunk.content.includes('import'));
    expect(hasImports).toBe(true);
    
    // Should capture exports  
    const hasExports = chunks.some(chunk => chunk.content.includes('export'));
    expect(hasExports).toBe(true);
    
    console.log(`✅ TSX support working: ${chunks.length} chunks generated from JSX code`);
  });
});