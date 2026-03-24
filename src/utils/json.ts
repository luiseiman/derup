/**
 * Parsa JSON con manejo seguro de errores.
 * 
 * @template T - Tipo esperado del resultado
 * @param json - String JSON a parsear
 * @param defaultValue - Valor a retornar si falla el parsing
 * @param onError - Callback opcional para manejar errores
 * @returns Objeto parseado o defaultValue si hay error
 * 
 * @example
 * const config = parseJSON(jsonString, defaultConfig);
 * const data = parseJSON(jsonString, {}, (error) => console.error(error));
 */
export const parseJSON = <T,>(
  json: string,
  defaultValue: T,
  onError?: (error: Error) => void
): T => {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(new Error(`JSON parse error: ${err.message}`));
    return defaultValue;
  }
};

/**
 * Valida que un valor sea un objeto válido.
 * 
 * @param value - Valor a validar
 * @returns true si es un objeto válido
 */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Valida que un valor sea un array.
 * 
 * @param value - Valor a validar
 * @returns true si es un array
 */
export const isArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

/**
 * Valida que un valor sea un string.
 * 
 * @param value - Valor a validar
 * @returns true si es un string
 */
export const isString = (value: unknown): value is string =>
  typeof value === 'string';

/**
 * Valida que un valor sea un número.
 * 
 * @param value - Valor a validar
 * @returns true si es un número
 */
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && !isNaN(value);

/**
 * Valida que un valor sea un booleano.
 *
 * @param value - Valor a validar
 * @returns true si es un booleano
 */
export const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

/**
 * Extrae un objeto JSON de un texto que puede contener markdown o texto libre.
 * Intenta primero con bloques de código cercados, luego busca el primer { ... }.
 */
export const extractJsonObject = (text: string): Record<string, unknown> | null => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    try { const r = JSON.parse(fenced[1].trim()) as unknown; if (isObject(r)) return r; } catch { /* continue */ }
  }
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { const r = JSON.parse(text.slice(s, e + 1)) as unknown; if (isObject(r)) return r; } catch { /* continue */ }
  }
  return null;
};
