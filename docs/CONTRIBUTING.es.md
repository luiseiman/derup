# Guia de Contribucion

## Alcance

derup es un modelador ER/EER academico para la catedra de Base de Datos de la UTN FRRe. Las contribuciones deben mejorar uno o mas de los siguientes aspectos:

- Precision conceptual ER/EER (elementos del diagrama, restricciones, algoritmo de mapeo)
- Usabilidad para docentes y estudiantes
- Robustez del flujo de modelado por chat y asistido por IA
- Cobertura de tests

Fuera de alcance: redisenos de UI no relacionados, nuevos proveedores de IA sin tests, cambios que rompan el algoritmo de derivacion del esquema relacional.

---

## Reportar bugs

Abrir un Issue en GitHub e incluir:

- Comportamiento esperado
- Comportamiento actual
- Pasos para reproducir (idealmente con un JSON de diagrama minimo que dispare el problema)
- Version del navegador y sistema operativo

---

## Proponer funcionalidades

Abrir un Issue en GitHub antes de comenzar la implementacion. Describir:

- El problema que se resuelve
- Solucion propuesta y alternativas consideradas
- Impacto academico (beneficia a docentes, estudiantes, o ambos?)

Esperar respuesta de un mantenedor antes de escribir codigo para funcionalidades grandes.

---

## Configuracion del entorno de desarrollo

```bash
# Fork y clonar
git clone https://github.com/<tu-fork>/derup.git
cd derup

# Instalar dependencias
npm install

# Iniciar proxy de IA y frontend en terminales separadas
npm run api
npm run dev
```

Abrir `http://127.0.0.1:5173`.

---

## Convenciones de codigo

### TypeScript
- `strict: true` es obligatorio — sin excepciones.
- Prohibido `any`. Usar `unknown` + type guard donde el tipo sea dinamico.
- Definir los tipos de props inline con el componente.

### React
- Solo componentes funcionales. Sin class components.
- Los hooks siguen la convencion del prefijo `use`.

### Estilos
- CSS custom properties para temas. Sin valores de color hardcodeados.
- Sin estilos inline para layout — usar nombres de clase.

### General
- Sin dependencias innecesarias. Si una utilidad es simple de escribir inline, hacerlo asi.
- Mantener `chatParser.ts` y `aiCommands.ts` desacoplados: el parser produce comandos; el modulo de comandos los aplica.
- Nunca hardcodear API keys ni secretos en ningun lugar del codigo fuente.

---

## Testing

Ejecutar la suite completa de tests antes de abrir un PR:

```bash
npm run test
```

Los 204 tests deben pasar. La nueva funcionalidad requiere nuevos tests.

Nomenclatura de archivos de test: `<unidad>.test.ts` co-ubicado con el archivo que se testea.

Formato de nombre de test: describir que se testea, bajo que condicion y cual es el resultado esperado.

```ts
it('agrega una entidad cuando el comando es "agregar entidad"', () => { ... });
it('devuelve array vacio cuando el diagrama no tiene nodos', () => { ... });
```

No mockear lo que se puede testear directamente. La suite de tests usa `jsdom` para tests dependientes del DOM y no mockea la logica del estado del diagrama.

---

## Estilo de commits

- Modo imperativo, tiempo presente: `add`, `fix`, `remove`, no `added` ni `fixes`.
- Primera linea de menos de 72 caracteres.
- Un cambio logico por commit.
- No combinar cambios no relacionados.

Ejemplos:
```
add SQL DDL view with copy-to-clipboard
fix weak entity PK derivation for composite partial keys
remove unused dependency from package.json
```

---

## Proceso de pull request

1. Crear una rama desde `main` con un nombre descriptivo (`fix/weak-entity-pk`, `feat/sql-view`, etc.).
2. Implementar el cambio con tests.
3. Verificar localmente:
   ```bash
   npm run lint
   npm run build
   npm run test
   ```
4. Abrir un PR contra `main`. Incluir:
   - Resumen de que cambio y por que
   - Pasos para probar manualmente
   - Capturas de pantalla o grabacion de pantalla para cambios de UI

Los PRs que rompan `npm run build` o reduzcan el numero de tests que pasan no seran mergeados.

---

## Codigo de conducta

- Ser directo y especifico en las revisiones. Senalar lineas; proponer alternativas.
- Sin critica personal. Criticar el codigo, no al autor.
- Los mantenedores tienen la ultima palabra en decisiones de alcance y diseno.
- Problemas de seguridad: reportar de forma privada via los security advisories de GitHub, no en issues publicos.
