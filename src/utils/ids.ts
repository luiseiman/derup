import { nanoid } from 'nanoid';

/**
 * Crea un identificador único para nodos y otros elementos.
 * Utiliza nanoid para garantizar unicidad con alto rendimiento.
 * 
 * @returns Identificador único de 21 caracteres (default de nanoid)
 * 
 * @example
 * const nodeId = createId(); // "V1StGXR_Z5j3eK4m2n9p0"
 */
export const createId = (): string => {
  return nanoid();
};
