import { AstCodeSplitter } from '../../splitter/ast-splitter';
import fs from 'fs';

describe('AST Splitter Debug Test', () => {
  it('should show what chunks are generated from intake-chat.tsx', async () => {
    const config = {
      chunkSize: 2500,
      chunkOverlap: 0
    };

    const testFile = '/Users/matt/dev/torch/archipelago/torch-ui/libs/assistant/feature/src/lib/ui/intake-chat.tsx';
    
    console.log('=== AST Splitter Debug Test ===');
    console.log(`Testing file: ${testFile}`);
    console.log(`Config: chunkSize=${config.chunkSize}, chunkOverlap=${config.chunkOverlap}`);
    console.log('');

    // Read the file content
    const content = fs.readFileSync(testFile, 'utf8');
    console.log(`File size: ${content.length} characters`);
    console.log('');

    // Create AST splitter
    const splitter = new AstCodeSplitter(config.chunkSize, config.chunkOverlap);

    // Split the content
    console.log('Splitting content...');
    const chunks = await splitter.split(content, 'typescript', testFile);

    console.log(`Generated ${chunks.length} chunks:`);
    console.log('');

    // Display each chunk with details
    chunks.forEach((chunk, index) => {
      console.log(`--- Chunk ${index + 1} ---`);
      console.log(`Content: ${chunk.content}`);
      console.log(`Length: ${chunk.content.length}`);
      console.log(`Start: ${chunk.metadata.startLine}`);
      console.log(`End: ${chunk.metadata.endLine}`);
      console.log('');
    });

    // Look for specific patterns
    console.log('=== Analysis ===');
    
    const chatHistoryImportChunks = chunks.filter(chunk => 
      chunk.content.includes('import') && chunk.content.includes('ChatHistory')
    );
    console.log(`Chunks containing ChatHistory import: ${chatHistoryImportChunks.length}`);
    
    const chatHistoryUsageChunks = chunks.filter(chunk => 
      chunk.content.includes('<ChatHistory') || chunk.content.includes('ChatHistory')
    );
    console.log(`Chunks containing ChatHistory usage: ${chatHistoryUsageChunks.length}`);
    
    const componentChunks = chunks.filter(chunk => 
      chunk.content.includes('function IntakeChat') || 
      chunk.content.includes('export function IntakeChat') ||
      chunk.content.includes('IntakeChat(')
    );
    console.log(`Chunks containing IntakeChat component: ${componentChunks.length}`);

    console.log('');
    console.log('=== Summary ===');
    console.log('This shows what chunks are being indexed in the vector database.');
    console.log('If ChatHistory imports/usage are missing, they won\'t be searchable.');
    
    // Assert something basic to make it a valid test
    expect(chunks.length).toBeGreaterThan(0);
  });
});