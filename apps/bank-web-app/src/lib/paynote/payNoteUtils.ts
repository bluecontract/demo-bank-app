import * as yaml from 'js-yaml';
import { PayNoteContent } from './types.ts';

/**
 * Encodes a PayNote object as base64-encoded YAML
 */
export function encodeObjectAsPayNoteBase64(obj: unknown): string {
  try {
    // Convert object to YAML string
    const yamlString = yaml.dump(obj, {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true, // Don't use references
    });

    // Encode as base64
    return btoa(yamlString);
  } catch (error) {
    console.error('Failed to encode object as PayNote:', error);
    return '';
  }
}

/**
 * Parses a Base64 PayNote to a PayNoteContent object
 */
export function decodePayNoteBase64AsObject(
  base64PayNote: string
): PayNoteContent | null {
  try {
    const decoded = atob(base64PayNote);

    // Try parsing as JSON first
    try {
      return JSON.parse(decoded) as PayNoteContent;
    } catch {
      // If JSON parsing fails, try YAML
      return yaml.load(decoded) as PayNoteContent;
    }
  } catch (error) {
    console.error('Failed to parse PayNote:', error);
    return null;
  }
}

/**
 * Decodes a Base64 PayNote to YAML string
 */
export function decodePayNoteBase64AsYaml(base64PayNote: string): string {
  try {
    return atob(base64PayNote);
  } catch (error) {
    console.error('Failed to decode PayNote:', error);
    return '';
  }
}

/**
 * Validates if a string is valid Base64
 */
export function isValidBase64(str: string): boolean {
  // Allow empty strings
  if (!str || str.trim().length === 0) {
    return true;
  }

  try {
    // Check if it matches base64 pattern
    const base64Regex = /^[0-9a-zA-Z+/]*={0,2}$/;
    if (!base64Regex.test(str)) return false;

    // Try to decode
    atob(str);
    return true;
  } catch {
    return false;
  }
}
