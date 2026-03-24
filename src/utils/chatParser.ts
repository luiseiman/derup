type ParsedEntityCommand = {
  type: 'add-entity';
  entityName: string;
  attributes: string[];
  keyAttributes: string[];
  useDefaultAttributes?: boolean;
};

type ParsedAddAttributesCommand = {
  type: 'add-attributes';
  entityName: string;
  attributes: string[];
  keyAttributes: string[];
  usesSelectedEntity?: boolean;
};

type ParsedReplaceAttributesCommand = {
  type: 'replace-attributes';
  entityName: string;
  attributes: string[];
  keyAttributes: string[];
  usesSelectedEntity?: boolean;
};

type ParsedRenameEntityCommand = {
  type: 'rename-entity';
  entityName: string;
  newName: string;
  usesSelectedEntity?: boolean;
};

type ParsedRelationshipCommand = {
  type: 'connect-entities';
  entityA: string;
  entityB: string;
  relationshipName?: string;
  usesSelectedEntity?: boolean;
};

type ParsedEntityAggregationCommand = {
  type: 'connect-entity-aggregation';
  entityName: string;
  aggregationEntityA: string;
  aggregationEntityB: string;
  relationshipName?: string;
};

type ParsedWeakEntityCommand = {
  type: 'set-entity-weakness';
  entityName: string;
  isWeak: boolean;
  usesSelectedEntity?: boolean;
};

type ParsedClearCommand = {
  type: 'clear-diagram';
};

type ParsedDeleteEntityCommand = {
  type: 'delete-entity';
  entityName: string;
};

export type ParsedChatCommand =
  | ParsedEntityCommand
  | ParsedAddAttributesCommand
  | ParsedReplaceAttributesCommand
  | ParsedRenameEntityCommand
  | ParsedRelationshipCommand
  | ParsedEntityAggregationCommand
  | ParsedWeakEntityCommand
  | ParsedClearCommand
  | ParsedDeleteEntityCommand;

const normalizeSpaces = (value: string) => value.trim().replace(/\s+/g, ' ');

const normalizeForMatch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const stripToken = (value: string) => value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const tokenize = (value: string) =>
  normalizeForMatch(value)
    .split(/\s+/)
    .map(stripToken)
    .filter(Boolean);

const levenshtein = (a: string, b: string) => {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
};

const fuzzyMatch = (token: string, keyword: string, maxDistance: number) => {
  if (!token) return false;
  if (token === keyword) return true;
  if (token.startsWith(keyword)) return true;
  if (keyword.length <= 3) return false;
  return levenshtein(token, keyword) <= maxDistance;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const splitList = (value: string) => {
  return value
    .split(',')
    .flatMap(part => part.split(/\s+y\s+/i))
    .map(item => normalizeSpaces(item))
    .filter(Boolean);
};

const extractEntityName = (text: string) => {
  const originalTokens = text.split(/\s+/).map(stripToken).filter(Boolean);
  const normalizedTokens = tokenize(text);
  const entityIndex = normalizedTokens.findIndex(token => fuzzyMatch(token, 'entidad', 2));
  if (entityIndex === -1 || !originalTokens[entityIndex + 1]) return null;

  const stopWords = ['con', 'que', 'atributo', 'atributos', 'atribut', 'donde', 'clave', 'relacion', 'relaciona'];
  const nameTokens: string[] = [];
  for (let i = entityIndex + 1; i < originalTokens.length; i += 1) {
    const normalized = normalizeForMatch(originalTokens[i]);
    if (stopWords.some(stop => fuzzyMatch(normalized, stop, 1))) break;
    nameTokens.push(originalTokens[i]);
  }
  if (nameTokens.length === 0) return null;
  return normalizeSpaces(nameTokens.join(' '));
};

const extractAttributesPart = (text: string) => {
  const match = text.match(/atribut\w*\s*[:−-]?\s*(.+)/i);
  if (match) {
    let part = match[1];
    const stopIndex = part.search(/\b(dond\w*|wher\w*|siend\w*|clav\w*)\b/i);
    if (stopIndex >= 0) {
      part = part.slice(0, stopIndex);
    }
    return normalizeSpaces(part);
  }

  const normalized = normalizeForMatch(text);
  const conIndex = normalized.indexOf(' con ');
  if (conIndex >= 0) {
    const afterCon = text.slice(conIndex + 4);
    // Stop at sentence boundary (.) or explicit stop words (not "clave" — handled via inline annotation)
    const dotStop = afterCon.indexOf('.');
    const afterConTrimmed = dotStop >= 0 ? afterCon.slice(0, dotStop) : afterCon;
    const stopIndex = afterConTrimmed.search(/\b(dond\w*|wher\w*|siend\w*|como)\b/i);
    const part = stopIndex >= 0 ? afterConTrimmed.slice(0, stopIndex) : afterConTrimmed;
    let trimmed = part.trim();
    // Strip leading field-list preamble: "los siguientes campos:", "campos:", "los campos:", etc.
    trimmed = trimmed.replace(/^(?:(?:los|las)\s+)?(?:siguiente[s]?\s+)?(?:campo[s]?|atributo[s]?|propiedad(?:es)?)\s*:\s*/i, '');
    // If what follows "con" is just a generic phrase like "sus atributos", return null
    if (/^(sus|los|las|propios?)\s+atribut\w*/i.test(trimmed)) return null;
    if (trimmed.length > 0) return normalizeSpaces(trimmed);
  }

  return null;
};

const extractAttributesForExistingEntity = (text: string) => {
  const betweenMatch = text.match(/atribut\w*\s*[:−-]?\s*(.+?)\s+(?:a\s+(?:la\s+)?entidad|a\s+esta\s+entidad|en\s+la\s+entidad|para\s+la\s+entidad)\b/i);
  if (betweenMatch) {
    return normalizeSpaces(betweenMatch[1]);
  }
  return extractAttributesPart(text);
};

const detectsDefaultAttributes = (text: string) => {
  const normalized = normalizeForMatch(text);
  return (
    normalized.includes('todos sus atributos') ||
    normalized.includes('todas sus atributos') ||
    normalized.includes('sus atributos') ||
    normalized.includes('sus propios atributos') ||
    normalized.includes('propios atributos') ||
    normalized.includes('atributos habituales') ||
    normalized.includes('atributos comunes') ||
    normalized.includes('atributos basicos') ||
    normalized.includes('atributos básicos') ||
    normalized.includes('atributos tipicos') ||
    normalized.includes('atributos típicos') ||
    normalized.includes('atributos por defecto')
  );
};

// Process "attr: clave/key/pk" inline type annotations.
// Returns cleaned attribute names and extracted key attributes.
const processInlineAnnotations = (rawAttrs: string[]): { attrs: string[]; extraKeys: string[] } => {
  const keyPattern = /^(.+?)\s*:\s*(clav\w*|key|llave|pk|primary)\s*$/i;
  const attrs: string[] = [];
  const extraKeys: string[] = [];
  for (const raw of rawAttrs) {
    const m = keyPattern.exec(raw);
    if (m) {
      const name = normalizeSpaces(m[1]);
      attrs.push(name);
      extraKeys.push(name);
    } else {
      attrs.push(raw);
    }
  }
  return { attrs, extraKeys };
};

const inferKeyAttributes = (text: string, attributes: string[]) => {
  if (attributes.length === 0) return [];
  const normalizedInput = normalizeForMatch(text);
  return attributes.filter(attr => {
    const normalizedAttr = normalizeForMatch(attr);
    return (
      normalizedInput.includes(`${normalizedAttr} es clav`) ||
      normalizedInput.includes(`${normalizedAttr} son clav`) ||
      normalizedInput.includes(`${normalizedAttr} como clav`) ||
      normalizedInput.includes(`clave ${normalizedAttr}`) ||
      normalizedInput.includes(`clav ${normalizedAttr}`)
    );
  });
};

const extractRelationshipName = (text: string) => {
  const directMatch = text.match(
    /relaci[oó]n\s+(?:llamad[ao]\s+)?(.+?)(?=\s+(?:no\s+debe|debe|deberia|debería|entre|con|que|es|sino)\b|[,.]|$)/i
  );
  if (directMatch) {
    const direct = normalizeSpaces(directMatch[1]).trim();
    if (direct) return direct;
  }

  const match = text.match(/relaci[oó]n\s+(?:llamad[ao]\s+)?([a-z0-9_\-áéíóúñ\s]+?)(?:\s+entre|\s+con|\s+que|\s*,|$)/i);
  if (!match) return undefined;
  const cleaned = normalizeSpaces(match[1]).replace(/\b(ya|debe|deberia|debería|sino)$/i, '').trim();
  return cleaned || undefined;
};

const findEntityMentions = (text: string, entityLabels: string[]) => {
  const normalizedText = normalizeForMatch(text);
  return entityLabels
    .map(label => {
      const normalizedLabel = normalizeForMatch(label);
      if (!normalizedLabel) return null;
      const regex = new RegExp(`\\b${escapeRegExp(normalizedLabel)}\\b`, 'i');
      const match = regex.exec(normalizedText);
      if (!match) return null;
      return { label, index: match.index };
    })
    .filter((match): match is { label: string; index: number } => match !== null)
    .sort((a, b) => a.index - b.index)
    .map(match => match.label);
};

const includesSelectedEntity = (text: string) => {
  const normalized = normalizeForMatch(text);
  return normalized.includes('esta entidad') || normalized.includes('esta entid') || normalized.includes('esta ent');
};

const extractAggregationPair = (text: string, entityLabels: string[]) => {
  const match = text.match(/agregaci[oó]n\s+(?:entre|de)\s+(.+)/i);
  if (!match) return null;
  const segment = match[1];
  const mentions = findEntityMentions(segment, entityLabels);
  if (mentions.length < 2) return null;
  return [mentions[0], mentions[1]] as const;
};

const extractAggregationMainEntity = (text: string, entityLabels: string[]) => {
  const match = text.match(/agregaci[oó]n\s+(?:entre|de)\s+(.+)/i);
  if (!match) return null;
  const prefix = text.slice(0, match.index ?? 0);
  const beforeMentions = findEntityMentions(prefix, entityLabels);
  if (beforeMentions.length === 0) return null;
  return beforeMentions[beforeMentions.length - 1] ?? null;
};

export const parseChatCommand = (input: string, entityLabels: string[] = []): ParsedChatCommand | null => {
  const text = normalizeSpaces(input);
  if (!text) return null;

  const normalizedTokens = tokenize(text);
  const normalizedText = normalizeForMatch(text);
  const deleteIntent = normalizedTokens.some(token =>
    ['borrar', 'borra', 'eliminar', 'elimina', 'limpiar', 'limpia', 'reset', 'reiniciar'].some(keyword =>
      fuzzyMatch(token, keyword, 2)
    )
  );
  const includesAll = normalizedTokens.some(token => fuzzyMatch(token, 'todo', 1));

  if (deleteIntent && (includesAll || normalizedText.includes('todo'))) {
    return { type: 'clear-diagram' };
  }

  const isAdd = normalizedTokens.some(token =>
    ['agregar', 'crear', 'anadir', 'add', 'create'].some(keyword => fuzzyMatch(token, keyword, 2))
  );
  const hasEntity = normalizedTokens.some(token => fuzzyMatch(token, 'entidad', 2));
  const hasAttributeIntent = normalizedTokens.some(token =>
    ['atributo', 'atributos', 'campo', 'campos', 'propiedad', 'propiedades'].some(keyword =>
      fuzzyMatch(token, keyword, 2)
    )
  );
  const isLinkIntent = normalizedTokens.some(token =>
    ['vincular', 'vincula', 'relacionar', 'relaciona', 'conectar', 'conecta', 'unir', 'une', 'asociar', 'asocia'].some(keyword =>
      fuzzyMatch(token, keyword, 2)
    )
  ) || normalizedTokens.some(token => fuzzyMatch(token, 'relacion', 2));
  const hasAggregationKeyword = normalizedText.includes('agregacion');

  const entityMentions = entityLabels.length > 0 ? findEntityMentions(text, entityLabels) : [];
  const hasWeakKeyword = normalizedTokens.some(token => fuzzyMatch(token, 'debil', 1) || fuzzyMatch(token, 'debilidad', 2));
  const hasStrongKeyword = normalizedTokens.some(token => fuzzyMatch(token, 'fuerte', 1));

  if (deleteIntent && !includesAll && !normalizedText.includes('todo') && hasEntity && entityMentions.length >= 1) {
    return { type: 'delete-entity', entityName: entityMentions[0] };
  }

  if (isLinkIntent && hasAggregationKeyword) {
    const relationshipName = extractRelationshipName(text);
    const pair = extractAggregationPair(text, entityLabels);
    if (pair) {
      const [aggregationEntityA, aggregationEntityB] = pair;
      const aggregationSet = new Set([aggregationEntityA, aggregationEntityB]);
      const prefixedMain = extractAggregationMainEntity(text, entityLabels);
      const entityName = prefixedMain ?? entityMentions.find(label => !aggregationSet.has(label));
      if (entityName) {
        return {
          type: 'connect-entity-aggregation',
          entityName,
          aggregationEntityA,
          aggregationEntityB,
          relationshipName,
        };
      }
    }
    // Evita interpretar una instrucción de agregación como relación binaria normal.
    return null;
  }

  // Self-relationship: explicit "recursiva/autorrelacion" + one entity mentioned
  const hasSelfRelationIntent = normalizedTokens.some(token =>
    ['recursiva', 'recursivo', 'autorrelacion', 'autorelacion', 'consigo', 'misma'].some(kw => fuzzyMatch(token, kw, 2))
  );
  if (isLinkIntent && hasSelfRelationIntent && entityMentions.length >= 1) {
    const relationshipName = extractRelationshipName(text);
    return { type: 'connect-entities', entityA: entityMentions[0], entityB: entityMentions[0], relationshipName };
  }

  if (isLinkIntent && (entityMentions.length >= 2 || includesSelectedEntity(text))) {
    const relationshipName = extractRelationshipName(text);
    if (entityMentions.length >= 2) {
      return {
        type: 'connect-entities',
        entityA: entityMentions[0],
        entityB: entityMentions[1],
        relationshipName,
      };
    }

    if (entityMentions.length === 1 && includesSelectedEntity(text)) {
      return {
        type: 'connect-entities',
        entityA: entityMentions[0],
        entityB: '__selected__',
        relationshipName,
        usesSelectedEntity: true,
      };
    }
  }

  if ((hasWeakKeyword || hasStrongKeyword) && (entityMentions.length >= 1 || includesSelectedEntity(text))) {
    const isWeak = hasWeakKeyword && !hasStrongKeyword;
    if (entityMentions.length >= 1) {
      return {
        type: 'set-entity-weakness',
        entityName: entityMentions[0],
        isWeak,
      };
    }

    if (includesSelectedEntity(text)) {
      return {
        type: 'set-entity-weakness',
        entityName: '__selected__',
        isWeak,
        usesSelectedEntity: true,
      };
    }
  }

  const isModify = normalizedTokens.some(token =>
    ['reemplazar', 'reemplaza', 'cambiar', 'cambia', 'modificar', 'modifica', 'actualizar', 'actualiza', 'sustituir', 'sustituye'].some(keyword =>
      fuzzyMatch(token, keyword, 2)
    )
  );

  if (isModify && hasAttributeIntent && (entityMentions.length >= 1 || includesSelectedEntity(text))) {
    const entityName = entityMentions[0] ?? (includesSelectedEntity(text) ? '__selected__' : null);
    if (entityName) {
      const attributesPart = extractAttributesForExistingEntity(text);
      const attributes = attributesPart ? splitList(attributesPart) : [];
      const keyAttributes = inferKeyAttributes(text, attributes);
      return {
        type: 'replace-attributes',
        entityName,
        attributes,
        keyAttributes,
        usesSelectedEntity: includesSelectedEntity(text),
      };
    }
  }

  const isRenameIntent = normalizedTokens.some(token =>
    ['renombrar', 'renombra', 'rebautizar', 'rebautiza'].some(keyword => fuzzyMatch(token, keyword, 2))
  ) || (normalizedText.includes('cambia') && (normalizedText.includes('nombre') || normalizedText.includes('nombr')));

  if (isRenameIntent && entityMentions.length >= 1) {
    const aIndex = normalizedText.lastIndexOf(' a ');
    if (aIndex >= 0) {
      const afterA = text.slice(aIndex + 3).trim();
      const newName = normalizeSpaces(afterA.split(/\s+/).slice(0, 3).join(' '));
      const entityName = entityMentions[0];
      if (newName && newName.toLowerCase() !== entityName.toLowerCase()) {
        return {
          type: 'rename-entity',
          entityName,
          newName,
          usesSelectedEntity: includesSelectedEntity(text),
        };
      }
    }
  }

  // When no known entity is mentioned and not targeting "this entity", only treat as add-attributes
  // if the attribute keyword appears BEFORE the "entidad" keyword (otherwise it's a create-entity command).
  const entityTokenIndex = normalizedTokens.findIndex(token => fuzzyMatch(token, 'entidad', 2));
  const attrTokenIndex = normalizedTokens.findIndex(token =>
    ['atributo', 'atributos', 'campo', 'campos', 'propiedad', 'propiedades'].some(keyword => fuzzyMatch(token, keyword, 2))
  );
  const isAddToExistingIntent =
    entityMentions.length >= 1 ||
    includesSelectedEntity(text) ||
    (hasEntity && attrTokenIndex >= 0 && entityTokenIndex >= 0 && attrTokenIndex < entityTokenIndex);

  if (isAdd && hasAttributeIntent && isAddToExistingIntent) {
    const entityName = entityMentions[0] ?? extractEntityName(text) ?? (includesSelectedEntity(text) ? '__selected__' : null);
    if (!entityName) return null;
    const attributesPart = extractAttributesForExistingEntity(text);
    const rawList = attributesPart ? splitList(attributesPart) : [];
    const { attrs: attributes, extraKeys } = processInlineAnnotations(rawList);
    const keyAttributes = [...new Set([...inferKeyAttributes(text, attributes), ...extraKeys])];
    return {
      type: 'add-attributes',
      entityName,
      attributes,
      keyAttributes,
      usesSelectedEntity: includesSelectedEntity(text),
    };
  }

  if (!isAdd || !hasEntity) return null;

  const entityName = extractEntityName(text);
  if (!entityName) return null;

  const attributesPart = extractAttributesPart(text);
  const rawList = attributesPart ? splitList(attributesPart) : [];
  const { attrs: attributes, extraKeys } = processInlineAnnotations(rawList);
  const keyAttributes = [...new Set([...inferKeyAttributes(text, attributes), ...extraKeys])];

  return {
    type: 'add-entity',
    entityName,
    attributes,
    keyAttributes,
    useDefaultAttributes: detectsDefaultAttributes(text),
  };
};
