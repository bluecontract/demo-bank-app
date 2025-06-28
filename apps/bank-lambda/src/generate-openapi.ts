import { generateOpenApi } from '@ts-rest/open-api';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { bankApiContract } from './api/contract.js';

// Generate OpenAPI spec
const openApiDocument = generateOpenApi(
  bankApiContract,
  {
    info: {
      title: 'Blue Demo Bank API',
      version: '1.0.0',
      description:
        'Banking API for Blue Demo Bank - A demonstration of secure banking operations with account management and transactions.',
      contact: {
        name: 'Blue Labs',
        url: 'https://blue-labs.com',
        email: 'support@blue-labs.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
      {
        url: 'https://api.demo-blue-bank.com',
        description: 'Production server',
      },
    ],
    tags: [
      {
        name: 'Health',
        description: 'Health check operations',
      },
    ],
  },
  {
    setOperationId: true,
    jsonQuery: false,
  }
);

// Ensure docs directory exists
const docsDir = join(__dirname, '..', 'docs');
mkdirSync(docsDir, { recursive: true });

// Write OpenAPI spec to file
const openApiPath = join(docsDir, 'openapi.json');
writeFileSync(openApiPath, JSON.stringify(openApiDocument, null, 2));

// Also generate YAML version
import * as yaml from 'js-yaml';
const openApiYamlPath = join(docsDir, 'openapi.yaml');
writeFileSync(openApiYamlPath, yaml.dump(openApiDocument));

console.log('✅ OpenAPI documentation generated:');
console.log(`   📄 JSON: ${openApiPath}`);
console.log(`   📄 YAML: ${openApiYamlPath}`);
console.log('');
console.log('🌐 To view the API docs, you can:');
console.log(
  '   1. Use Swagger UI: https://petstore.swagger.io/ (upload the JSON file)'
);
console.log(
  '   2. Use Redoc: https://redocly.github.io/redoc/ (paste the JSON URL)'
);
console.log('   3. Install a local viewer like swagger-ui-cli or redoc-cli');
