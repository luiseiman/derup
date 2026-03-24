import { useState, useEffect } from 'react';

/**
 * Custom hook para sincronizar estado con localStorage.
 * Maneja automáticamente lectura y escritura, con manejo de errores.
 * 
 * @template T - Tipo de dato a almacenar
 * @param key - Clave en localStorage
 * @param defaultValue - Valor por defecto si no existe en localStorage
 * @param options - Opciones adicionales (serializer, deserializer, onError)
 * @returns [estado, setter] - Tupla con estado y función para actualizar
 * 
 * @example
 * const [name, setName] = useLocalStorage('user_name', 'Guest');
 * const [config, setConfig] = useLocalStorage('app_config', defaultConfig);
 */
export const useLocalStorage = <T,>(
  key: string,
  defaultValue: T,
  options?: {
    serializer?: (value: T) => string;
    deserializer?: (value: string) => T;
    onError?: (error: Error) => void;
  }
) => {
  const serializer = options?.serializer || JSON.stringify;
  const deserializer = options?.deserializer || (JSON.parse as (value: string) => T);
  const onError = options?.onError;

  const [state, setState] = useState<T>(defaultValue);
  const [isInitialized, setIsInitialized] = useState(false);

  // Lectura inicial desde localStorage
  useEffect(() => {
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        setState(deserializer(item));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(new Error(`Failed to load from localStorage key "${key}": ${err.message}`));
    } finally {
      setIsInitialized(true);
    }
  }, [key, deserializer, onError]);

  // Escritura en localStorage cuando el estado cambia
  useEffect(() => {
    if (!isInitialized) return;

    try {
      if (state === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, serializer(state));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(new Error(`Failed to save to localStorage key "${key}": ${err.message}`));
    }
  }, [state, key, serializer, isInitialized, onError]);

  return [state, setState] as const;
};
