import yaml from 'js-yaml';
import { apiClient } from '../../api/client';
import type {
  PdfTextItem,
  ProblemDto,
} from '@demo-bank-app/shared-bank-api-contract';

interface ParseResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Parser {
  parse(file: File): Promise<ParseResult>;
}

class JSONParser implements Parser {
  async parse(file: File): Promise<ParseResult> {
    try {
      const input = await file.text();
      const data = JSON.parse(input);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }
}

class YamlParser implements Parser {
  async parse(file: File): Promise<ParseResult> {
    try {
      const input = await file.text();
      const data = yaml.load(input);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid YAML',
      };
    }
  }
}

class Base64JSONParser implements Parser {
  async parse(file: File): Promise<ParseResult> {
    try {
      const input = await file.text();
      const decoded = atob(input);
      const data = JSON.parse(decoded);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid Base64 JSON',
      };
    }
  }
}

class Base64YamlParser implements Parser {
  async parse(file: File): Promise<ParseResult> {
    try {
      const input = await file.text();
      const decoded = atob(input);
      const data = yaml.load(decoded);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid Base64 YAML',
      };
    }
  }
}

class PdfParser implements Parser {
  async parse(file: File): Promise<ParseResult> {
    try {
      const pdfjsLib = await import('pdfjs-dist');

      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const items: PdfTextItem[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const contentItems = content.items as PdfTextItem[];
        contentItems.forEach(item => {
          if (item.str) {
            items.push(item);
          }
        });
      }

      const text = items.map(i => i.str).join('');

      const pseudoFile = new File([text], 'file.txt', {
        type: 'text/plain',
      });

      for (const parser of ParserFactory.parsers) {
        const result = await parser.parse(pseudoFile);
        if (result.success) {
          return result;
        }
      }

      if (items.length > 0) {
        const llmResult = await parsePdfItemsWithLlm(items as PdfTextItem[]);
        if (llmResult.success) {
          return llmResult;
        }
        if (llmResult.error) {
          return llmResult;
        }
      }

      return {
        success: false,
        error: 'Unable to parse PDF content as any supported format',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse PDF',
      };
    }
  }
}

class ParserFactory {
  static readonly jsonParser = new JSONParser();
  static readonly yamlParser = new YamlParser();
  static readonly pdfParser = new PdfParser();

  // order matters, first try base64 ones, for example yaml loader can load any base64 string and pretend it is valid yaml
  static readonly parsers: Parser[] = [
    new Base64JSONParser(),
    new Base64YamlParser(),
    ParserFactory.jsonParser,
    ParserFactory.yamlParser,
  ];

  static getParserFromFilename(filename: string): Parser | null {
    const lowerFilename = filename.toLowerCase();

    if (lowerFilename.endsWith('.json')) {
      return ParserFactory.jsonParser;
    }

    if (lowerFilename.endsWith('.yaml') || lowerFilename.endsWith('.yml')) {
      return ParserFactory.yamlParser;
    }

    if (lowerFilename.endsWith('.pdf')) {
      return ParserFactory.pdfParser;
    }

    return null;
  }
}

export async function parsePayNoteFile(file: File): Promise<ParseResult> {
  const filename = file.name;

  if (filename) {
    const hintedParser = ParserFactory.getParserFromFilename(filename);
    if (hintedParser) {
      const result = await hintedParser.parse(file);

      if (result.success) {
        return result;
      }
    }
  }

  // if filename does not hint try any
  for (const parser of ParserFactory.parsers) {
    const result = await parser.parse(file);
    if (result.success) {
      return result;
    }
  }

  return {
    success: false,
    error: 'Unable to parse content as any supported format',
  };
}

async function parsePdfItemsWithLlm(
  items: PdfTextItem[]
): Promise<ParseResult> {
  try {
    const response = await apiClient.banking.parsePayNotePdf({
      body: { items },
    });

    if (response.status !== 200) {
      const errorBody = response.body as ProblemDto;
      return {
        success: false,
        error:
          errorBody.detail ??
          errorBody.message ??
          'The PayNote assistant could not reconstruct the PDF content.',
      };
    }

    const yamlContent = response.body.yaml;

    try {
      const data = yaml.load(yamlContent);
      return { success: true, data };
    } catch (parseError) {
      return {
        success: false,
        error:
          parseError instanceof Error
            ? parseError.message
            : 'The reconstructed YAML is invalid.',
      };
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unexpected error while reconstructing PDF content.',
    };
  }
}

export const __testing = {
  parsePdfItemsWithLlm,
};
