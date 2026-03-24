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
