import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import Canvas from './components/Canvas/Canvas';
import type { ERNode, Connection, NodeType, Cardinality, DiagramView, Aggregation, ISANode, EntityNode } from './types/er';
import { createId } from './utils/ids';
import { parseDiagramSnapshot, serializeDiagram } from './utils/diagram';
import { parseChatCommand } from './utils/chatParser';
import { useLocalStorage } from './hooks/useLocalStorage';
import { safeCardinality } from './utils/schemas';
import Toolbar from './components/Toolbar/Toolbar';
import type { ToolbarItem } from './components/Toolbar/Toolbar';

type AIProvider = 'gemini' | 'grok' | 'ollama' | 'openclaw';
type AIConnectivityStatus = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'missing-key';

/**
 * Presets de atributos por defecto para entidades comunes en educación.
 */
const DEFAULT_ATTRIBUTE_PRESETS: Record<string, { label: string; attributes: string[] }> = {
  alumno: { label: 'Alumno', attributes: ['id', 'nombre', 'apellido', 'email', 'telefono', 'fecha_nacimiento'] },
  estudiante: { label: 'Estudiante', attributes: ['id', 'nombre', 'apellido', 'email', 'telefono', 'fecha_nacimiento'] },
  profesor: { label: 'Profesor', attributes: ['id', 'nombre', 'apellido', 'email', 'telefono', 'especialidad'] },
  empleado: { label: 'Empleado', attributes: ['id', 'nombre', 'apellido', 'email', 'telefono', 'puesto'] },
  curso: { label: 'Curso', attributes: ['id', 'nombre', 'descripcion', 'creditos'] },
  departamento: { label: 'Departamento', attributes: ['id', 'nombre', 'ubicacion', 'telefono'] },
  proyecto: { label: 'Proyecto', attributes: ['id', 'nombre', 'fecha_inicio', 'fecha_fin', 'presupuesto'] },
  farmacia: { label: 'Farmacia', attributes: ['id', 'nombre', 'localidad', 'direccion', 'telefono'] },
  cliente: { label: 'Cliente', attributes: ['id', 'nombre', 'apellido', 'email', 'telefono'] },
  auto: { label: 'Auto', attributes: ['id', 'patente', 'marca', 'modelo', 'color'] },
  vehiculo: { label: 'Vehículo', attributes: ['id', 'patente', 'marca', 'modelo', 'color'] },
  chofer: { label: 'Chofer', attributes: ['id', 'nombre', 'apellido', 'dni', 'licencia'] },
};

function App() {
  const [nodes, setNodes] = useState<ERNode[]>([
    { id: '1', type: 'entity', position: { x: 100, y: 100 }, label: 'Student', isWeak: false },
    { id: '2', type: 'entity', position: { x: 400, y: 100 }, label: 'Course', isWeak: false },
    { id: '3', type: 'relationship', position: { x: 250, y: 100 }, label: 'Enrolled', isIdentifying: false },
    { id: '4', type: 'attribute', position: { x: 100, y: 200 }, label: 'Name', isKey: false, isMultivalued: false, isDerived: false }
  ]);

  const [connections, setConnections] = useState<Connection[]>([
    { id: 'c1', sourceId: '1', targetId: '3', isTotalParticipation: false, cardinality: 'M' },
    { id: 'c2', sourceId: '3', targetId: '2', isTotalParticipation: false, cardinality: 'N' },
    { id: 'c3', sourceId: '1', targetId: '4', isTotalParticipation: false }
  ]);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  const [selectedAggregationIds, setSelectedAggregationIds] = useState<Set<string>>(new Set());
  const [aggregations, setAggregations] = useState<Aggregation[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState<string | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [chatSuggestionIndex, setChatSuggestionIndex] = useState(-1);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState<AIProvider>('openclaw');
  const [aiModel, setAiModel] = useState('openai-codex/gpt-5.4');
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [grokModels, setGrokModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openclawModels, setOpenclawModels] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<'idle' | 'thinking'>('idle');
  const [aiThinkingSeconds, setAiThinkingSeconds] = useState(0);
  const [geminiApiKey, setGeminiApiKey] = useLocalStorage('gemini_api_key', '');
  const [grokApiKey, setGrokApiKey] = useLocalStorage('grok_api_key', '');
  const [aiConnectivity, setAiConnectivity] = useState<{
    gemini: AIConnectivityStatus;
    grok: AIConnectivityStatus;
    ollama: AIConnectivityStatus;
    openclaw: AIConnectivityStatus;
  }>({
    gemini: 'unknown',
    grok: 'unknown',
    ollama: 'unknown',
    openclaw: 'unknown',
  });
  const [aiConnectivityReason, setAiConnectivityReason] = useState<{ gemini: string; grok: string; ollama: string; openclaw: string }>({
    gemini: '',
    grok: '',
    ollama: '',
    openclaw: '',
  });
  const [lastAIProviderUsed, setLastAIProviderUsed] = useState<AIProvider | null>(null);
  const [lastAIFallbackFrom, setLastAIFallbackFrom] = useState<AIProvider | null>(null);
  const [attributePresets, setAttributePresets] = useLocalStorage('derup.presets.v1', DEFAULT_ATTRIBUTE_PRESETS);
  const [presetSelection, setPresetSelection] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetAttributesInput, setPresetAttributesInput] = useState('');
  const [modelingHints, setModelingHints] = useLocalStorage<string[]>('derup.modeling.hints.v1', []);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'properties' | 'chat' | 'ai' | 'menu'>('properties');

  const [roomId, setRoomId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isSyncingRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetFileInputRef = useRef<HTMLInputElement>(null);
  const snapshotTimerRef = useRef<number | null>(null);

  const SNAPSHOT_KEY = 'derup.snapshot.v1';

  const currentView: DiagramView = { scale, offset };
  const canConnectSelection = useMemo(() => {
    const connectableIds = Array.from(new Set([...selectedNodeIds, ...selectedAggregationIds]));
    if (connectableIds.length !== 2) return false;
    const [id1, id2] = connectableIds;

    const isAgg1 = selectedAggregationIds.has(id1);
    const isAgg2 = selectedAggregationIds.has(id2);
    if (isAgg1 && isAgg2) return false;

    if (isAgg1 || isAgg2) {
      const nonAggId = isAgg1 ? id2 : id1;
      const nonAggNode = nodes.find(n => n.id === nonAggId);
      return !!nonAggNode && nonAggNode.type === 'relationship';
    }
    return true;
  }, [nodes, selectedAggregationIds, selectedNodeIds]);

  useEffect(() => {
    try {
      setHasSnapshot(!!localStorage.getItem(SNAPSHOT_KEY));
    } catch {
      setHasSnapshot(false);
    }
  }, []);

  // useLocalStorage hook handles all localStorage persisting automatically
  // for: geminiApiKey, grokApiKey, attributePresets, modelingHints

  useEffect(() => {
    if (aiStatus !== 'thinking') {
      setAiThinkingSeconds(0);
      return;
    }

    const start = Date.now();
    setAiThinkingSeconds(0);
    const timer = window.setInterval(() => {
      setAiThinkingSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [aiStatus]);

  useEffect(() => {
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
    }

    snapshotTimerRef.current = window.setTimeout(() => {
      try {
        const payload = serializeDiagram(nodes, aggregations, connections, { scale, offset });
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
        setHasSnapshot(true);
      } catch {
        // Ignore snapshot failures (e.g., storage quota)
      }
    }, 400);

    return () => {
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
      }
    };
  }, [nodes, aggregations, connections, scale, offset, SNAPSHOT_KEY]);

  const applySnapshot = (snapshot: { nodes: ERNode[]; aggregations: Aggregation[]; connections: Connection[]; view?: DiagramView }) => {
    setNodes(snapshot.nodes);
    setAggregations(snapshot.aggregations ?? []);
    setConnections(snapshot.connections);
    if (snapshot.view) {
      setScale(snapshot.view.scale);
      setOffset(snapshot.view.offset);
    } else {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
    setSelectedNodeIds(new Set());
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
    setLastSelectedNodeId(null);
  };

  const handleExport = () => {
    const payload = serializeDiagram(nodes, aggregations, connections, currentView);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `derup-diagram-${timestamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseDiagramSnapshot(JSON.parse(text));
      if (!parsed) {
        alert('El archivo no tiene un formato válido de diagrama.');
        return;
      }
      applySnapshot(parsed);
    } catch {
      alert('No se pudo importar el archivo. Verifica que sea un JSON válido.');
    }
  };

  const handleRestoreSnapshot = () => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = parseDiagramSnapshot(JSON.parse(raw));
      if (!parsed) {
        alert('La instantánea guardada está dañada.');
        return;
      }
      applySnapshot(parsed);
    } catch {
      alert('No se pudo restaurar la instantánea.');
    }
  };

  const handleResetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const getCanvasCenter = () => {
    const sidebarWidth = sidebarOpen ? 320 : 0;
    const toolbarHeight = 40;
    return {
      x: (window.innerWidth - sidebarWidth) / 2,
      y: (window.innerHeight - toolbarHeight) / 2,
    };
  };

  const clampScale = (value: number) => Math.min(Math.max(0.1, value), 5);

  const setZoom = (value: number) => {
    setScale(clampScale(value));
  };

  const addNode = (type: NodeType) => {
    const id = createId();

    let position = { x: 0, y: 0 };
    let parentNodeId: string | null = null;

    if (type === 'attribute' && selectedNodeIds.size === 1) {
      parentNodeId = Array.from(selectedNodeIds)[0];
      const parentNode = nodes.find(n => n.id === parentNodeId);
      if (parentNode) {
        position = { x: parentNode.position.x + 100, y: parentNode.position.y + 50 };
      } else {
        const { x: centerX, y: centerY } = getCanvasCenter();
        position = { x: (centerX - offset.x) / scale, y: (centerY - offset.y) / scale };
      }
    } else {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2 - 50;
      position = { x: (centerX - offset.x) / scale, y: (centerY - offset.y) / scale };
    }

    const label = `New ${type}`;

    let newNode: ERNode;

    if (type === 'entity') {
      newNode = { id, type: 'entity', position, label, isWeak: false };
    } else if (type === 'relationship') {
      newNode = { id, type: 'relationship', position, label, isIdentifying: false };
    } else if (type === 'attribute') {
      newNode = { id, type: 'attribute', position, label, isKey: false, isMultivalued: false, isDerived: false };
    } else {
      newNode = { id, type: 'isa', position, label: 'ES', isDisjoint: false, isTotal: false };
    }

    const newNodes = [...nodes, newNode];
    setNodes(newNodes);

    if (parentNodeId) {
      const newConn: Connection = {
        id: createId(),
        sourceId: parentNodeId,
        targetId: id,
        isTotalParticipation: false
      };
      setConnections([...connections, newConn]);
    }

    setSelectedNodeIds(new Set([id]));
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
    setLastSelectedNodeId(id);
  };

  const handleNodeClick = (id: string, multi: boolean) => {
    setSelectedNodeIds(prev => {
      const newSet = new Set(multi ? prev : []);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    setLastSelectedNodeId(id);
    if (!multi) {
      setSelectedConnectionIds(new Set());
      setSelectedAggregationIds(new Set());
    }
  };

  const handleConnectionClick = (id: string, multi: boolean) => {
    setSelectedConnectionIds(prev => {
      const newSet = new Set(multi ? prev : []);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    if (!multi) {
      setSelectedNodeIds(new Set());
      setSelectedAggregationIds(new Set());
    }
  };

  const handleCanvasClick = () => {
    setSelectedNodeIds(new Set());
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
    setLastSelectedNodeId(null);
  };

  const deleteSelected = () => {
    const remainingNodes = nodes.filter(n => !selectedNodeIds.has(n.id));
    const remainingAggregations = aggregations
      .filter(agg => !selectedAggregationIds.has(agg.id))
      .map(agg => ({
        ...agg,
        memberIds: agg.memberIds.filter(id => !selectedNodeIds.has(id))
      }))
      .filter(agg => agg.memberIds.length >= 2);

    const remainingAggregationIds = new Set(remainingAggregations.map(agg => agg.id));
    const removedAggregationIds = new Set(
      aggregations.map(agg => agg.id).filter(id => !remainingAggregationIds.has(id))
    );

    const remainingConnections = connections.filter(c =>
      !selectedConnectionIds.has(c.id) &&
      !selectedNodeIds.has(c.sourceId) && !selectedNodeIds.has(c.targetId) &&
      !selectedAggregationIds.has(c.sourceId) && !selectedAggregationIds.has(c.targetId) &&
      !removedAggregationIds.has(c.sourceId) && !removedAggregationIds.has(c.targetId)
    );
    setNodes(remainingNodes);
    setAggregations(remainingAggregations);
    setConnections(remainingConnections);
    setSelectedNodeIds(new Set());
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
  };

  const updateNode = (id: string, updates: Partial<ERNode>) => {
    let updatedNodes = nodes.map(n => n.id === id ? { ...n, ...updates } as ERNode : n);

    // Automation for Weak Entity
    if ('isWeak' in updates && typeof updates.isWeak === 'boolean' && updates.isWeak === true) {
      // Find connected relationships
      const connectedItems = connections
        .filter(c => c.sourceId === id || c.targetId === id)
        .map(c => {
          const otherId = c.sourceId === id ? c.targetId : c.sourceId;
          const otherNode = nodes.find(n => n.id === otherId);
          return { connectionId: c.id, otherNode };
        })
        .filter(item => item.otherNode?.type === 'relationship');

      const connectedRelIds = new Set(connectedItems.map(i => i.otherNode!.id));
      const connectedConnIds = new Set(connectedItems.map(i => i.connectionId));

      // 1. Set connected Relationships to Identifying
      updatedNodes = updatedNodes.map(n => {
        if (connectedRelIds.has(n.id)) {
          return { ...n, isIdentifying: true } as ERNode;
        }
        return n;
      });

      // 2. Set Connections to Total Participation & Cardinality '1'
      const updatedConnections = connections.map(c => {
        if (connectedConnIds.has(c.id)) {
          return { ...c, isTotalParticipation: true, cardinality: '1' as Cardinality };
        }
        return c;
      });
      setConnections(updatedConnections);
    }

    setNodes(updatedNodes);
  };

  const updateConnection = (id: string, updates: Partial<Connection>) => {
    setConnections(connections.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const connectSelected = () => {
    const connectableIds = Array.from(new Set([...selectedNodeIds, ...selectedAggregationIds]));
    if (connectableIds.length !== 2) return;
    const [id1, id2] = connectableIds;

    const isAgg1 = selectedAggregationIds.has(id1);
    const isAgg2 = selectedAggregationIds.has(id2);
    const node1 = nodes.find(n => n.id === id1) ?? null;
    const node2 = nodes.find(n => n.id === id2) ?? null;

    if (isAgg1 || isAgg2) {
      const nonAggNode = isAgg1 ? node2 : node1;
      if (!nonAggNode || nonAggNode.type !== 'relationship' || (isAgg1 && isAgg2)) {
        alert('Solo se permite conectar una agregación con una relación.');
        return;
      }
    }

    // Count existing connections between these two nodes
    const existingCount = connections.filter(c =>
      (c.sourceId === id1 && c.targetId === id2) ||
      (c.sourceId === id2 && c.targetId === id1)
    ).length;

    // Allow up to 2 connections (for reflexive relationships with roles)
    if (existingCount >= 2) return;

    const newConn: Connection = {
      id: createId(),
      sourceId: id1,
      targetId: id2,
      isTotalParticipation: false,
      role: existingCount === 1 ? 'role2' : ''
    };

    // If this is the second connection, also set a default role on the first one if it doesn't have one
    if (existingCount === 1) {
      const firstConn = connections.find(c =>
        (c.sourceId === id1 && c.targetId === id2) ||
        (c.sourceId === id2 && c.targetId === id1)
      );
      if (firstConn && !firstConn.role) {
        setConnections(connections.map(c =>
          c.id === firstConn.id ? { ...c, role: 'role1' } : c
        ).concat(newConn));
        return;
      }
    }

    setConnections([...connections, newConn]);
  };

  const normalizeEntityLabel = (value: string) => {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) return 'Entidad';
    if (trimmed === trimmed.toLowerCase()) {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
    return trimmed;
  };


  const normalizeLabelForPreset = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const inferAttributesFromLabel = (entityLabel: string) => {
    const normalized = normalizeLabelForPreset(entityLabel);
    const groups: Array<{ keywords: string[]; attributes: string[] }> = [
      {
        keywords: ['auto', 'vehiculo', 'coche', 'carro', 'camion', 'moto', 'bus'],
        attributes: ['id', 'patente', 'marca', 'modelo', 'color'],
      },
      {
        keywords: ['chofer', 'conductor', 'driver', 'taxista', 'profesor', 'alumno', 'estudiante', 'empleado', 'cliente', 'usuario'],
        attributes: ['id', 'nombre', 'apellido', 'dni', 'telefono'],
      },
      {
        keywords: ['empresa', 'compania', 'compañia', 'organizacion', 'organizacion', 'negocio'],
        attributes: ['id', 'nombre', 'ruc', 'direccion', 'telefono'],
      },
      {
        keywords: ['sucursal', 'oficina', 'tienda', 'local', 'farmacia', 'deposito', 'almacen'],
        attributes: ['id', 'nombre', 'direccion', 'ciudad', 'telefono'],
      },
      {
        keywords: ['curso', 'materia', 'asignatura'],
        attributes: ['id', 'nombre', 'descripcion', 'creditos', 'nivel'],
      },
      {
        keywords: ['proyecto', 'tarea'],
        attributes: ['id', 'nombre', 'fecha_inicio', 'fecha_fin', 'estado'],
      },
    ];

    const match = groups.find(group =>
      group.keywords.some(keyword => normalized.includes(keyword))
    );
    return match ? match.attributes : ['id', 'nombre', 'descripcion', 'estado', 'fecha_creacion'];
  };

  const normalizeAttributeList = (list: string[], max = 5) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of list) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
      if (result.length >= max) break;
    }
    return result;
  };

  const ensureKeyAttribute = (list: string[], keyCandidates: string[], max = 5) => {
    const normalized = list.map(attr => attr.toLowerCase());
    const keyFromInput = keyCandidates.find(candidate => normalized.includes(candidate.toLowerCase()));
    let attributes = [...list];
    let keyAttr = keyFromInput ?? keyCandidates[0];

    if (!keyAttr) {
      if (normalized.includes('id')) {
        keyAttr = 'id';
      } else {
        keyAttr = 'id';
        attributes = ['id', ...attributes];
      }
    } else if (!normalized.includes(keyAttr.toLowerCase())) {
      attributes = [keyAttr, ...attributes];
    }

    if (attributes.length > max) {
      attributes = attributes.slice(0, max);
      if (!attributes.some(attr => attr.toLowerCase() === keyAttr.toLowerCase())) {
        attributes[attributes.length - 1] = keyAttr;
      }
    }

    return { attributes, keys: [keyAttr] };
  };

  const getPresetAttributesForEntity = (entityLabel: string) => {
    const normalizedEntity = normalizeLabelForPreset(entityLabel);
    const preset = attributePresets[normalizedEntity];
    return preset ? preset.attributes : null;
  };

  const getDefaultAttributesForEntity = (entityLabel: string) => {
    const preset = getPresetAttributesForEntity(entityLabel);
    if (preset) return preset;
    return inferAttributesFromLabel(entityLabel);
  };

  const upsertPreset = (label: string, attributes: string[]) => {
    const key = normalizeLabelForPreset(label);
    if (!key) return;
    setAttributePresets(prev => ({
      ...prev,
      [key]: {
        label: label.trim(),
        attributes,
      },
    }));
  };

  const extractJsonFromText = (text: string) => {
    const candidates: string[] = [];
    const fencedBlocks = text.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
    fencedBlocks.forEach(block => {
      const cleaned = block.replace(/```(?:json)?/i, '').replace(/```$/, '').trim();
      if (cleaned) candidates.push(cleaned);
    });

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      candidates.push(text.slice(start, end + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // try next candidate
      }
    }
    return null;
  };

  const describeAIError = (error: unknown, provider: AIProvider = aiProvider) => {
    const message = error instanceof Error ? error.message : '';
    const normalizedMessage = message.toLowerCase();
    const isTimeout =
      normalizedMessage.includes('aborted') ||
      normalizedMessage.includes('aborterror') ||
      normalizedMessage.includes('timeout');
    if (provider === 'gemini') {
      if (isTimeout) {
        return 'Gemini tardó demasiado en responder. Intenta con un modelo más liviano o con un escenario más corto.';
      }
      if (normalizedMessage.includes('missing gemini api key')) {
        return 'Falta la API Key de Gemini. Ingresa la clave en el panel o en `.env`.';
      }
      if (normalizedMessage.includes('api key')) {
        return `Error de Gemini: ${message}`;
      }
      return 'No pude conectar con la API de Gemini. Verifica que el servidor local esté corriendo y tengas una API Key válida.';
    }
    if (provider === 'grok') {
      if (isTimeout) {
        return 'Grok tardó demasiado en responder. Intenta con un modelo más liviano o con un prompt más corto.';
      }
      if (normalizedMessage.includes('missing grok api key') || normalizedMessage.includes('missing xai api key')) {
        return 'Falta la API Key de Grok. Ingresa la clave en el panel o en `.env` (XAI_API_KEY).';
      }
      if (normalizedMessage.includes('api key') || normalizedMessage.includes('unauthorized') || normalizedMessage.includes('authentication')) {
        return `Error de Grok: ${message}`;
      }
      return 'No pude conectar con la API de Grok. Verifica que el proxy local esté corriendo y tu API Key sea válida.';
    }
    const ollamaModel = provider === aiProvider
      ? (aiModel.trim() || 'gemma3')
      : 'gemma3';
    if (isTimeout) {
      return `Ollama tardó demasiado en responder con el modelo "${ollamaModel}". Prueba un modelo más liviano o un escenario más corto.`;
    }
    if (normalizedMessage.includes('model') && normalizedMessage.includes('not found')) {
      return `Ollama está conectado, pero el modelo "${ollamaModel}" no está instalado. Ejecuta: ollama pull ${ollamaModel}`;
    }
    if (normalizedMessage.includes('failed to fetch') || normalizedMessage.includes('connection refused')) {
      return 'No pude conectar con Ollama. Verifica que el servicio esté corriendo en localhost.';
    }
    if (message && message !== 'ai_request_failed') {
      return `Error de Ollama: ${message}`;
    }
    return 'No pude conectar con Ollama. Verifica que el servicio esté corriendo en localhost.';
  };

  const formatThinkingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs = 2000) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      return response;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const readApiErrorMessage = async (response: Response, fallback: string) => {
    try {
      const json = await response.clone().json();
      if (typeof json?.error === 'string' && json.error.trim()) return json.error.trim();
      if (typeof json?.message === 'string' && json.message.trim()) return json.message.trim();
    } catch {
      // ignore json parse failures
    }
    try {
      const text = await response.clone().text();
      if (text.trim()) return text.trim().slice(0, 240);
    } catch {
      // ignore text parse failures
    }
    return fallback;
  };

  const checkGeminiHealth = async () => {
    setAiConnectivity(prev => ({ ...prev, gemini: 'checking' }));
    setAiConnectivityReason(prev => ({ ...prev, gemini: 'Verificando conexión con Gemini...' }));
    try {
      const response = await fetchWithTimeout('/api/gemini/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: geminiApiKey.trim() }),
      }, 2000);
      if (response.ok) {
        const data = await response.json() as { models?: string[] };
        const models = Array.isArray(data?.models)
          ? data.models.filter(model => typeof model === 'string' && model.trim().length > 0)
          : [];
        setGeminiModels(models);
        setAiConnectivity(prev => ({ ...prev, gemini: 'connected' }));
        setAiConnectivityReason(prev => ({
          ...prev,
          gemini: models.length > 0
            ? `Modelos detectados: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`
            : 'Conectada, pero no se detectaron modelos compatibles.',
        }));
        return;
      }
      if (response.status === 401) {
        setAiConnectivity(prev => ({ ...prev, gemini: 'missing-key' }));
        setGeminiModels([]);
        setAiConnectivityReason(prev => ({ ...prev, gemini: 'Falta API Key de Gemini en la UI o en .env.' }));
        return;
      }
      const reason = await readApiErrorMessage(response, `Gemini devolvió HTTP ${response.status}.`);
      setAiConnectivity(prev => ({ ...prev, gemini: 'disconnected' }));
      setGeminiModels([]);
      setAiConnectivityReason(prev => ({ ...prev, gemini: reason }));
    } catch {
      setAiConnectivity(prev => ({ ...prev, gemini: 'disconnected' }));
      setGeminiModels([]);
      setAiConnectivityReason(prev => ({ ...prev, gemini: 'No se pudo conectar al proxy local de Gemini (http://127.0.0.1:8787).' }));
    }
  };

  const checkGrokHealth = async () => {
    setAiConnectivity(prev => ({ ...prev, grok: 'checking' }));
    setAiConnectivityReason(prev => ({ ...prev, grok: 'Verificando conexión con Grok...' }));
    try {
      const response = await fetchWithTimeout('/api/grok/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: grokApiKey.trim() }),
      }, 2000);
      if (response.ok) {
        const data = await response.json() as { models?: string[] };
        const models = Array.isArray(data?.models)
          ? data.models.filter(model => typeof model === 'string' && model.trim().length > 0)
          : [];
        setGrokModels(models);
        setAiConnectivity(prev => ({ ...prev, grok: 'connected' }));
        setAiConnectivityReason(prev => ({
          ...prev,
          grok: models.length > 0
            ? `Modelos detectados: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`
            : 'Conectada, pero no se detectaron modelos compatibles.',
        }));
        return;
      }
      if (response.status === 401) {
        setAiConnectivity(prev => ({ ...prev, grok: 'missing-key' }));
        setGrokModels([]);
        setAiConnectivityReason(prev => ({ ...prev, grok: 'Falta API Key de Grok en la UI o en .env (XAI_API_KEY).' }));
        return;
      }
      const reason = await readApiErrorMessage(response, `Grok devolvió HTTP ${response.status}.`);
      setAiConnectivity(prev => ({ ...prev, grok: 'disconnected' }));
      setGrokModels([]);
      setAiConnectivityReason(prev => ({ ...prev, grok: reason }));
    } catch {
      setAiConnectivity(prev => ({ ...prev, grok: 'disconnected' }));
      setGrokModels([]);
      setAiConnectivityReason(prev => ({ ...prev, grok: 'No se pudo conectar al proxy local de Grok (http://127.0.0.1:8787).' }));
    }
  };

  const checkOllamaHealth = async () => {
    setAiConnectivity(prev => ({ ...prev, ollama: 'checking' }));
    setAiConnectivityReason(prev => ({ ...prev, ollama: 'Verificando conexión con Ollama...' }));
    try {
      const response = await fetchWithTimeout('/api/ollama/tags', { method: 'GET' }, 2000);
      if (response.ok) {
        try {
          const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
          const models = Array.isArray(data?.models)
            ? data.models
              .map(model => (typeof model?.name === 'string' ? model.name : model?.model))
              .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
            : [];
          setOllamaModels(Array.from(new Set(models)));
          setAiConnectivityReason(prev => ({
            ...prev,
            ollama: models.length > 0
              ? `Modelos detectados: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`
              : 'Ollama conectado, sin modelos instalados.',
          }));
        } catch {
          setOllamaModels([]);
          setAiConnectivityReason(prev => ({ ...prev, ollama: 'Ollama responde, pero no pude leer la lista de modelos.' }));
        }
        setAiConnectivity(prev => ({ ...prev, ollama: 'connected' }));
        return;
      }
      const reason = await readApiErrorMessage(response, `Ollama devolvió HTTP ${response.status}.`);
      setOllamaModels([]);
      setAiConnectivity(prev => ({ ...prev, ollama: 'disconnected' }));
      setAiConnectivityReason(prev => ({ ...prev, ollama: reason }));
    } catch {
      setOllamaModels([]);
      setAiConnectivity(prev => ({ ...prev, ollama: 'disconnected' }));
      setAiConnectivityReason(prev => ({ ...prev, ollama: 'No se pudo conectar a Ollama en localhost:11434.' }));
    }
  };

  const checkOpenclawHealth = async () => {
    setAiConnectivity(prev => ({ ...prev, openclaw: 'checking' }));
    setAiConnectivityReason(prev => ({ ...prev, openclaw: 'Verificando conexión con OpenClaw...' }));
    try {
      const response = await fetchWithTimeout('/api/openclaw/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }, 3000);
      if (response.ok) {
        const data = await response.json() as { models?: string[] };
        const models = Array.isArray(data?.models) ? data.models.filter((m): m is string => typeof m === 'string' && m.trim().length > 0) : [];
        setOpenclawModels(models);
        setAiConnectivityReason(prev => ({
          ...prev,
          openclaw: models.length > 0 ? `Modelos: ${models.join(', ')}` : 'OpenClaw conectado.',
        }));
        setAiConnectivity(prev => ({ ...prev, openclaw: 'connected' }));
        return;
      }
      const reason = await readApiErrorMessage(response, `OpenClaw devolvió HTTP ${response.status}.`);
      setOpenclawModels([]);
      setAiConnectivity(prev => ({ ...prev, openclaw: 'disconnected' }));
      setAiConnectivityReason(prev => ({ ...prev, openclaw: reason }));
    } catch {
      setOpenclawModels([]);
      setAiConnectivity(prev => ({ ...prev, openclaw: 'disconnected' }));
      setAiConnectivityReason(prev => ({ ...prev, openclaw: 'No se pudo conectar a OpenClaw Gateway.' }));
    }
  };

  useEffect(() => {
    if (aiProvider !== 'openclaw') return;
    if (openclawModels.length === 0) return;
    if (!openclawModels.includes(aiModel)) {
      setAiModel(openclawModels[0]);
    }
  }, [aiProvider, aiModel, openclawModels]);

  useEffect(() => {
    if (aiProvider !== 'ollama') return;
    if (ollamaModels.length === 0) return;
    if (!ollamaModels.includes(aiModel)) {
      setAiModel(ollamaModels[0]);
    }
  }, [aiProvider, aiModel, ollamaModels]);

  useEffect(() => {
    if (aiProvider !== 'gemini') return;
    if (geminiModels.length === 0) return;
    if (geminiModels.includes(aiModel)) return;
    const preferred = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    const nextModel = preferred.find(model => geminiModels.includes(model)) ?? geminiModels[0];
    setAiModel(nextModel);
  }, [aiProvider, aiModel, geminiModels]);

  useEffect(() => {
    if (aiProvider !== 'grok') return;
    if (grokModels.length === 0) return;
    if (grokModels.includes(aiModel)) return;
    const preferred = ['grok-4-fast', 'grok-3-mini', 'grok-2-latest'];
    const nextModel = preferred.find(model => grokModels.includes(model)) ?? grokModels[0];
    setAiModel(nextModel);
  }, [aiProvider, aiModel, grokModels]);

  useEffect(() => {
    let active = true;
    const runChecks = async () => {
      if (!active) return;
      await Promise.all([checkGeminiHealth(), checkGrokHealth(), checkOllamaHealth(), checkOpenclawHealth()]);
    };

    runChecks();
    return () => {
      active = false;
    };
  }, [geminiApiKey, grokApiKey]);

  const getProviderLabel = (provider: AIProvider) =>
    provider === 'gemini' ? 'Gemini' : provider === 'grok' ? 'Grok' : provider === 'ollama' ? 'Ollama' : 'OpenClaw';

  const getStatusLabel = (provider: AIProvider, status: AIConnectivityStatus) => {
    if (status === 'checking') return 'Comprobando';
    if (status === 'connected') return 'Conectada';
    if (status === 'missing-key') return (provider === 'ollama' || provider === 'openclaw') ? 'Desconectada' : 'Sin API Key';
    if (status === 'disconnected') return 'Desconectada';
    return 'Desconocida';
  };

  const getStatusClass = (status: AIConnectivityStatus) => {
    if (status === 'connected') return 'status-pill status-online';
    if (status === 'checking') return 'status-pill status-checking';
    if (status === 'missing-key') return 'status-pill status-warn';
    if (status === 'disconnected') return 'status-pill status-offline';
    return 'status-pill';
  };

  const getProviderApiKey = (provider: AIProvider) => {
    if (provider === 'gemini') return geminiApiKey.trim();
    if (provider === 'grok') return grokApiKey.trim();
    return '';
  };

  const providerNeedsApiKey = (provider: AIProvider) => provider === 'gemini' || provider === 'grok';

  const getProviderModel = (provider: AIProvider) => {
    if (provider === 'gemini') {
      if (provider === aiProvider && aiModel.trim()) return aiModel.trim();
      const preferred = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
      return preferred.find(model => geminiModels.includes(model)) ?? geminiModels[0] ?? 'gemini-2.5-pro';
    }
    if (provider === 'grok') {
      if (provider === aiProvider && aiModel.trim()) return aiModel.trim();
      const preferred = ['grok-4-fast', 'grok-3-mini', 'grok-2-latest'];
      return preferred.find(model => grokModels.includes(model)) ?? grokModels[0] ?? 'grok-3-mini';
    }
    if (provider === 'openclaw') {
      if (provider === aiProvider && aiModel.trim()) return aiModel.trim();
      return openclawModels[0] ?? 'openai-codex/gpt-5.4';
    }
    if (provider === aiProvider && aiModel.trim()) return aiModel.trim();
    return ollamaModels[0] ?? 'gemma3';
  };

  const fetchAITextFromProvider = async (
    provider: AIProvider,
    prompt: string,
    timeoutMs?: number
  ) => {
    const requestUrl =
      provider === 'gemini'
        ? '/api/gemini'
        : provider === 'grok'
          ? '/api/grok'
          : provider === 'openclaw'
            ? '/api/openclaw'
            : '/api/ollama/generate';
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        provider === 'gemini'
          ? { prompt, model: getProviderModel(provider), apiKey: getProviderApiKey(provider) }
          : provider === 'grok'
            ? { prompt, model: getProviderModel(provider), apiKey: getProviderApiKey(provider) }
            : provider === 'openclaw'
              ? { prompt, model: getProviderModel(provider) }
              : { prompt, model: getProviderModel(provider), stream: false }
      ),
    };

    const response = typeof timeoutMs === 'number'
      ? await fetchWithTimeout(requestUrl, requestInit, timeoutMs)
      : await fetch(requestUrl, requestInit);

    if (!response.ok) {
      let errorMessage = 'ai_request_failed';
      try {
        const data = await response.json();
        if (typeof data?.error === 'string' && data.error.trim()) {
          errorMessage = data.error.trim();
        }
      } catch {
        // ignore json parse failures
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return provider === 'gemini' || provider === 'grok' || provider === 'openclaw'
      ? (typeof data.text === 'string' ? data.text.trim() : '')
      : (typeof data.response === 'string' ? data.response.trim() : '');
  };

  const requestAIText = async (prompt: string, timeoutMs?: number) => {
    setLastAIFallbackFrom(null);
    const primary = aiProvider;
    const providerOrder: AIProvider[] = [primary, ...(['gemini', 'grok', 'ollama', 'openclaw'] as AIProvider[]).filter(p => p !== primary)];

    const isProviderConfigured = (provider: AIProvider) => {
      if (providerNeedsApiKey(provider)) return !!getProviderApiKey(provider);
      return true;
    };

    const canFallbackToProvider = (provider: AIProvider) => {
      const status = aiConnectivity[provider];
      if (status === 'disconnected' || status === 'missing-key') return false;
      return isProviderConfigured(provider);
    };

    let primaryError: unknown = null;

    for (const provider of providerOrder) {
      if (provider !== primary && !canFallbackToProvider(provider)) continue;
      if (provider === primary && !isProviderConfigured(provider)) continue;
      try {
        const text = await fetchAITextFromProvider(provider, prompt, timeoutMs);
        setLastAIProviderUsed(provider);
        setLastAIFallbackFrom(provider === primary ? null : primary);
        return text;
      } catch (error) {
        if (provider === primary) {
          primaryError = error;
        }
      }
    }

    throw (primaryError ?? new Error('ai_request_failed'));
  };

  const inferAttributesWithAI = async (entityLabel: string) => {
    const prompt =
      `Genera hasta 5 atributos propios para la entidad "${entityLabel}". ` +
      `Responde SOLO con JSON en una línea: ` +
      `{"attributes":["id","..."],"key":"id"}. ` +
      `Reglas: atributos en español y snake_case, la clave debe estar dentro de attributes, máximo 5.`;

    const aiText = await requestAIText(prompt);
    const json = extractJsonFromText(aiText);
    if (!json || !Array.isArray(json.attributes)) return null;

    const attrs = json.attributes.filter((attr: unknown) => typeof attr === 'string') as string[];
    const key = typeof json.key === 'string' ? json.key : 'id';
    const normalized = normalizeAttributeList(attrs, 5);
    const ensured = ensureKeyAttribute(normalized, [key], 5);
    return {
      attributes: ensured.attributes,
      key: ensured.keys[0],
    };
  };

  type ScenarioEntity = {
    name: string;
    attributes?: unknown;
    key?: unknown;
  };

  type ScenarioParticipant = {
    entity?: unknown;
    cardinality?: unknown;
    total?: unknown;
    role?: unknown;
  };

  type ScenarioRelationship = {
    name: string;
    participants?: unknown;
    attributes?: unknown;
  };

  type ScenarioISA = {
    supertype?: unknown;
    subtypes?: unknown;
    disjoint?: unknown;
    total?: unknown;
    label?: unknown;
  };

  type ScenarioAggregation = {
    name?: unknown;
    label?: unknown;
    relationship?: unknown;
    relation?: unknown;
    baseRelationship?: unknown;
    members?: unknown;
    entities?: unknown;
    memberEntities?: unknown;
    mainEntity?: unknown;
    entity?: unknown;
    parentRelationship?: unknown;
    connectorRelationship?: unknown;
    relationshipName?: unknown;
  };

  type ScenarioModel = {
    entities?: unknown;
    relationships?: unknown;
    isa?: unknown;
    aggregations?: unknown;
  };

  type ScenarioEntityNormalized = {
    name: string;
    attributes: string[];
    key?: string;
  };

  type ScenarioRelationshipNormalized = {
    name: string;
    participants: Array<{
      entity: string;
      cardinality?: Cardinality;
      total?: boolean;
      role?: string;
    }>;
    attributes: string[];
  };

  type ScenarioISANormalized = {
    supertype: string;
    subtypes: string[];
    disjoint: boolean;
    total: boolean;
    label: string;
  };

  type ScenarioAggregationNormalized = {
    label?: string;
    baseRelationship?: string;
    memberEntities: string[];
    connectorRelationship?: string;
    mainEntity?: string;
  };

  type ScenarioModelNormalized = {
    entities: ScenarioEntityNormalized[];
    relationships: ScenarioRelationshipNormalized[];
    isas: ScenarioISANormalized[];
    aggregations: ScenarioAggregationNormalized[];
  };

  /**
   * Construye un bloque de texto con reglas de modelado aprendidas del usuario.
   * Estas reglas se incluyen en los prompts de IA para mantener consistencia.
   * 
   * @returns String con formato de hints para incluir en prompts, o string vacío si no hay hints
   * 
   * @example
   * const hints = buildModelingHintsBlock();
   * const prompt = `${GUIDE}\n${hints}Escenario: ${text}`;
   */
  const buildModelingHintsBlock = () => {
    if (modelingHints.length === 0) return '';
    return `Reglas aprendidas del usuario:\n${modelingHints.map(hint => `- ${hint}`).join('\n')}\n`;
  };

  const SCENARIO_MASTER_GUIDE =
    `Rol: Eres un Asistente de Modelado Conceptual ER/EER (estilo Ramakrishnan–Gehrke).\n` +
    `Objetivo: transformar requisitos de negocio en un modelo ER/EER correcto y minimalista, capturando semántica con claves, participación/completitud, ISA, agregación y relaciones n-arias.\n` +
    `\n` +
    `Modo de trabajo obligatorio:\n` +
    `1) Extrae hechos del texto ("Cada X...", "Un Y puede...").\n` +
    `2) Decide entidades y atributos.\n` +
    `3) Decide relaciones y cardinalidades.\n` +
    `4) Marca participación total/parcial por participante.\n` +
    `5) Evalúa ISA (disjoint/overlap y covering/partial).\n` +
    `6) Evalúa agregación (cuando una relación se relaciona con otra entidad).\n` +
    `7) Evalúa relaciones ternarias (o más) cuando el hecho depende simultáneamente de 3 participantes.\n` +
    `\n` +
    `Heurísticas obligatorias:\n` +
    `- Key constraint: usa cardinalidad "1" del lado que implique "a lo sumo uno", "único", "principal", "titular".\n` +
    `- Participación total: usa total=true cuando el texto indique "debe", "siempre", "al menos uno", "sin excepción".\n` +
    `- ISA: crea subtipos cuando haya atributos exclusivos, relaciones exclusivas o "tipos de" con identidad compartida.\n` +
    `- Agregación: úsala cuando una relación deba ser tratada como objeto para conectarla con otra entidad/relación.\n` +
    `- Binaria vs ternaria: si el hecho depende de (A,B,C) de forma conjunta, mantén relación ternaria.\n` +
    `\n` +
    `Si falta información, infiere lo mínimo razonable y registra supuestos breves en notes.assumptions con impacto.`;

  const normalizeScenarioNameList = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => normalizeEntityLabel(item))
      .filter(Boolean);
  };

  /**
   * Normaliza un modelo de escenario desde JSON, validando tipos y estructura.
   * Limpia y estandariza datos como nombres de entidades, atributos y relaciones.
   * 
   * @param json - Modelo JSON bruto del escenario
   * @returns Modelo normalizado o null si es inválido
   * 
   * @example
   * const normalized = normalizeScenarioModelFromJson(jsonData);
   * if (!normalized) alert('Modelo inválido');
   */
  const normalizeScenarioModelFromJson = (json: ScenarioModel | null): ScenarioModelNormalized | null => {
    if (!json || typeof json !== 'object') return null;
    const entitiesRaw = Array.isArray(json.entities) ? json.entities : [];
    const relationshipsRaw = Array.isArray(json.relationships) ? json.relationships : [];
    const isaRaw = Array.isArray(json.isa) ? json.isa : [];
    const aggregationsRaw = Array.isArray(json.aggregations) ? json.aggregations : [];

    const entities: ScenarioEntityNormalized[] = entitiesRaw
      .filter((entity): entity is ScenarioEntity => entity && typeof entity === 'object' && typeof (entity as ScenarioEntity).name === 'string')
      .map(entity => ({
        name: entity.name.trim(),
        attributes: normalizeScenarioAttributes(entity.attributes, 5),
        key: typeof entity.key === 'string' ? entity.key.trim() : undefined,
      }))
      .filter(entity => entity.name.length > 0);

    const relationships: ScenarioRelationshipNormalized[] = relationshipsRaw
      .filter((rel): rel is ScenarioRelationship => rel && typeof rel === 'object' && typeof (rel as ScenarioRelationship).name === 'string')
      .map(rel => ({
        name: rel.name.trim(),
        participants: Array.isArray(rel.participants)
          ? rel.participants
            .filter((participant): participant is ScenarioParticipant => participant && typeof participant === 'object')
            .map(participant => ({
              entity: typeof participant.entity === 'string' ? participant.entity.trim() : '',
              cardinality: normalizeScenarioCardinality(participant.cardinality) ?? undefined,
              total: typeof participant.total === 'boolean' ? participant.total : false,
              role: typeof participant.role === 'string' ? participant.role.trim() : undefined,
            }))
            .filter(participant => participant.entity.length > 0)
          : [],
        attributes: normalizeScenarioAttributes(rel.attributes, 4),
      }))
      .filter(rel => rel.name.length > 0);

    const isas: ScenarioISANormalized[] = isaRaw
      .filter((item): item is ScenarioISA => !!item && typeof item === 'object')
      .map(item => ({
        supertype: typeof item.supertype === 'string' ? normalizeEntityLabel(item.supertype) : '',
        subtypes: normalizeScenarioNameList(item.subtypes),
        disjoint: typeof item.disjoint === 'boolean' ? item.disjoint : false,
        total: typeof item.total === 'boolean' ? item.total : false,
        label: typeof item.label === 'string' && item.label.trim() ? normalizeEntityLabel(item.label) : 'ES',
      }))
      .filter(item => item.supertype.length > 0 && item.subtypes.length > 0);

    const aggregations: ScenarioAggregationNormalized[] = aggregationsRaw
      .filter((item): item is ScenarioAggregation => !!item && typeof item === 'object')
      .map(item => {
        const memberEntitiesDirect = normalizeScenarioNameList(item.memberEntities);
        const entitiesDirect = normalizeScenarioNameList(item.entities);
        const membersAsArray = normalizeScenarioNameList(item.members);
        const membersObject =
          item.members && typeof item.members === 'object' && !Array.isArray(item.members)
            ? item.members as { entities?: unknown; memberEntities?: unknown; relationship?: unknown }
            : null;
        const membersFromObject = membersObject
          ? [
            ...normalizeScenarioNameList(membersObject.entities),
            ...normalizeScenarioNameList(membersObject.memberEntities),
          ]
          : [];

        const baseRelationshipFromMembers =
          membersObject && typeof membersObject.relationship === 'string'
            ? normalizeEntityLabel(membersObject.relationship)
            : undefined;

        const baseRelationship = [
          item.baseRelationship,
          item.relationship,
          item.relation,
          baseRelationshipFromMembers,
        ].find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;

        const connectorRelationship = [
          item.connectorRelationship,
          item.parentRelationship,
          item.relationshipName,
          item.name,
        ].find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;

        const mainEntity = [item.mainEntity, item.entity]
          .find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;

        const members = normalizeAttributeList(
          [
            ...memberEntitiesDirect,
            ...entitiesDirect,
            ...membersAsArray,
            ...membersFromObject,
          ],
          8
        );

        return {
          label: typeof item.label === 'string' && item.label.trim()
            ? normalizeEntityLabel(item.label)
            : undefined,
          baseRelationship: typeof baseRelationship === 'string' ? normalizeEntityLabel(baseRelationship) : undefined,
          memberEntities: members,
          connectorRelationship: typeof connectorRelationship === 'string' ? normalizeEntityLabel(connectorRelationship) : undefined,
          mainEntity: typeof mainEntity === 'string' ? normalizeEntityLabel(mainEntity) : undefined,
        };
      })
      .filter(item => !!item.baseRelationship || item.memberEntities.length > 0);

    return { entities, relationships, isas, aggregations };
  };

  /**
   * Valida y sanitiza un modelo de escenario normalizado.
   * Verifica: entidades duplicadas, atributos válidos, relaciones válidas,
   * ISA correctas, y agregaciones con ambos extremos definidos.
   * 
   * @param model - Modelo de escenario normalizado
   * @returns Objeto con modelo sanitizado y lista errores encontrados
   * @throws Nunca lanza, retorna errores en el objeto
   * 
   * @example
   * const result = sanitizeScenarioModel(normalized);
   * if (result.errors.length > 0) console.warn(result.errors);
   */
  const sanitizeScenarioModel = (model: ScenarioModelNormalized) => {
    const errors: string[] = [];
    const entitiesByKey = new Map<string, ScenarioEntityNormalized>();

    model.entities.forEach(entity => {
      const label = normalizeEntityLabel(entity.name);
      const key = normalizeLabelForPreset(label);
      if (!key) return;
      if (entitiesByKey.has(key)) {
        errors.push(`Entidad duplicada: ${label}`);
        return;
      }
      const normalizedAttributes = normalizeAttributeList(entity.attributes, 5);
      const { attributes, keys } = ensureKeyAttribute(
        normalizedAttributes,
        entity.key ? [entity.key] : [],
        5
      );
      entitiesByKey.set(key, {
        name: label,
        attributes,
        key: keys[0],
      });
    });

    const entityKeys = new Set(entitiesByKey.keys());
    const relationships: ScenarioRelationshipNormalized[] = [];
    const relationshipByKey = new Map<string, ScenarioRelationshipNormalized>();
    const relationshipParticipantKeys = new Map<string, Set<string>>();

    model.relationships.forEach(rel => {
      const relationshipName = normalizeEntityLabel(rel.name);
      const relationshipKey = normalizeLabelForPreset(relationshipName);
      const participants = rel.participants
        .map(participant => ({
          entity: normalizeEntityLabel(participant.entity),
          cardinality: (participant.cardinality === '1' ? '1' : 'N') as Cardinality,
          total: !!participant.total,
          role: participant.role?.trim() || undefined,
        }))
        .filter(participant => {
          const exists = entityKeys.has(normalizeLabelForPreset(participant.entity));
          if (!exists) errors.push(`Relación ${relationshipName} referencia entidad inexistente: ${participant.entity}`);
          return exists;
        });

      if (participants.length < 2) {
        errors.push(`Relación inválida (menos de 2 participantes): ${relationshipName}`);
        return;
      }

      relationships.push({
        name: relationshipName,
        participants,
        attributes: normalizeAttributeList(rel.attributes, 4),
      });

      if (relationshipKey) {
        relationshipByKey.set(relationshipKey, {
          name: relationshipName,
          participants,
          attributes: normalizeAttributeList(rel.attributes, 4),
        });
        relationshipParticipantKeys.set(
          relationshipKey,
          new Set(participants.map(participant => normalizeLabelForPreset(participant.entity)))
        );
      }
    });

    const isas: ScenarioISANormalized[] = [];
    model.isas.forEach(isa => {
      const supertype = normalizeEntityLabel(isa.supertype);
      const supertypeKey = normalizeLabelForPreset(supertype);
      if (!entityKeys.has(supertypeKey)) {
        errors.push(`ISA inválida: supertipo inexistente "${supertype}".`);
        return;
      }

      const subtypeKeys = new Set<string>();
      const subtypes = isa.subtypes
        .map(subtype => normalizeEntityLabel(subtype))
        .filter(subtype => {
          const subtypeKey = normalizeLabelForPreset(subtype);
          if (!entityKeys.has(subtypeKey)) {
            errors.push(`ISA inválida: subtipo inexistente "${subtype}".`);
            return false;
          }
          if (subtypeKey === supertypeKey) return false;
          if (subtypeKeys.has(subtypeKey)) return false;
          subtypeKeys.add(subtypeKey);
          return true;
        });

      if (subtypes.length === 0) {
        errors.push(`ISA inválida: "${supertype}" no tiene subtipos válidos.`);
        return;
      }

      isas.push({
        supertype,
        subtypes,
        disjoint: !!isa.disjoint,
        total: !!isa.total,
        label: isa.label?.trim() || 'ES',
      });
    });

    const aggregations: ScenarioAggregationNormalized[] = [];
    model.aggregations.forEach(aggregation => {
      const memberEntities = aggregation.memberEntities
        .map(entity => normalizeEntityLabel(entity))
        .filter(entity => {
          const key = normalizeLabelForPreset(entity);
          if (!entityKeys.has(key)) {
            errors.push(`Agregación inválida: entidad miembro inexistente "${entity}".`);
            return false;
          }
          return true;
        });

      let baseRelationship = aggregation.baseRelationship
        ? normalizeEntityLabel(aggregation.baseRelationship)
        : undefined;

      if (baseRelationship) {
        const key = normalizeLabelForPreset(baseRelationship);
        if (!relationshipByKey.has(key)) {
          errors.push(`Agregación inválida: relación base inexistente "${baseRelationship}".`);
          baseRelationship = undefined;
        }
      }

      if (!baseRelationship && memberEntities.length >= 2) {
        const memberKeys = new Set(memberEntities.map(entity => normalizeLabelForPreset(entity)));
        const candidates = Array.from(relationshipByKey.entries())
          .filter(([key]) => {
            const participantSet = relationshipParticipantKeys.get(key);
            if (!participantSet) return false;
            for (const memberKey of memberKeys) {
              if (!participantSet.has(memberKey)) return false;
            }
            return true;
          })
          .map(([, rel]) => rel.name);
        if (candidates.length === 1) {
          baseRelationship = candidates[0];
        }
      }

      if (!baseRelationship) {
        errors.push('Agregación inválida: falta relación base.');
        return;
      }

      let connectorRelationship = aggregation.connectorRelationship
        ? normalizeEntityLabel(aggregation.connectorRelationship)
        : undefined;
      if (connectorRelationship) {
        const key = normalizeLabelForPreset(connectorRelationship);
        if (!relationshipByKey.has(key)) {
          errors.push(`Agregación inválida: relación conectora inexistente "${connectorRelationship}".`);
          connectorRelationship = undefined;
        }
      }

      let mainEntity = aggregation.mainEntity ? normalizeEntityLabel(aggregation.mainEntity) : undefined;
      if (mainEntity) {
        const key = normalizeLabelForPreset(mainEntity);
        if (!entityKeys.has(key)) {
          errors.push(`Agregación inválida: entidad principal inexistente "${mainEntity}".`);
          mainEntity = undefined;
        }
      }

      if (connectorRelationship && !mainEntity) {
        const connector = relationshipByKey.get(normalizeLabelForPreset(connectorRelationship));
        const memberSet = new Set(memberEntities.map(entity => normalizeLabelForPreset(entity)));
        const candidate = connector?.participants
          .map(participant => normalizeEntityLabel(participant.entity))
          .find(entity => !memberSet.has(normalizeLabelForPreset(entity)));
        if (candidate) {
          mainEntity = candidate;
        }
      }

      aggregations.push({
        label: aggregation.label,
        baseRelationship,
        memberEntities: normalizeAttributeList(memberEntities, 8),
        connectorRelationship,
        mainEntity,
      });
    });

    const entities = Array.from(entitiesByKey.values());
    if (entities.length === 0) {
      errors.push('No se detectaron entidades válidas.');
    }
    if (relationships.length === 0) {
      errors.push('No se detectaron relaciones válidas.');
    }

    return {
      model: { entities, relationships, isas, aggregations },
      errors,
    };
  };

  /**
   * Intenta reparar un modelo de escenario usando IA.
   * Usa la guía SCENARIO_MASTER_GUIDE y hints acumulados para mejorar la validez del modelo.
   * 
   * @param scenarioText - Descripción original del escenario
   * @param rawModelText - JSON bruto que falló la validación
   * @param validationErrors - Lista de errores encontrados durante validación
   * @returns Modelo normalizado reparado, o null si AI falla o retorna JSON inválido
   * @throws No lanza, retorna null si hay error
   * 
   * @example
   * const repaired = await repairScenarioModelWithAI(text, badJson, errors);
   * if (repaired) applyRepairScenario(repaired);
   */
  const repairScenarioModelWithAI = async (
    scenarioText: string,
    rawModelText: string,
    validationErrors: string[]
  ) => {
    const hintsBlock = buildModelingHintsBlock();
    const prompt =
      `${SCENARIO_MASTER_GUIDE}\n` +
      `Corrige el JSON de modelado ER para que sea válido.\n` +
      `Responde SOLO con JSON en una línea con forma:\n` +
      `{"entities":[{"name":"Entidad","attributes":["id","nombre"],"key":"id"}],"relationships":[{"name":"Relacion","participants":[{"entity":"Entidad","cardinality":"1","total":true,"role":"rol_opcional"}],"attributes":[]}],"isa":[{"supertype":"Persona","subtypes":["Profesor"],"disjoint":true,"total":false,"label":"ES"}],"aggregations":[{"baseRelationship":"AsisteEn","memberEntities":["EstudianteGraduado","Proyecto"],"connectorRelationship":"Supervisa","mainEntity":"Profesor"}],"notes":{"facts":[],"assumptions":[],"decisions":[],"checklist":[]}}\n` +
      `Reglas:\n` +
      `- Solo entidades, relaciones, ISA y agregaciones.\n` +
      `- Cada entidad debe tener clave incluida en attributes.\n` +
      `- Cada relación debe tener al menos 2 participantes válidos.\n` +
      `- cardinality solo "1" o "N".\n` +
      `- Usa relaciones n-arias cuando sea necesario (participants puede tener 2 o más entidades).\n` +
      `- ISA y aggregations son opcionales; incluye solo si aplica al escenario.\n` +
      `- No uses markdown ni texto fuera del JSON.\n` +
      `${hintsBlock}` +
      `Errores detectados:\n- ${validationErrors.join('\n- ')}\n` +
      `Escenario original:\n${scenarioText}\n` +
      `JSON a corregir:\n${rawModelText}`;

    const repairedText = await requestAIText(prompt);
    const repairedJson = extractJsonFromText(repairedText) as ScenarioModel | null;
    return normalizeScenarioModelFromJson(repairedJson);
  };

  const looksLikeScenario = (value: string) => {
    const text = value.trim();
    if (text.length >= 280) return true;
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const bulletCount = lines.filter(line => /^[-•*]/.test(line)).length;
    if (bulletCount >= 2) return true;
    return /considere|escenario|diagrama\s+er|diseñ|informaci[óo]n sobre/i.test(text);
  };

  const normalizeScenarioCardinality = (value: unknown): Cardinality | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toUpperCase();
    if (normalized === '1' || normalized === 'N' || normalized === 'M') return normalized;
    if (normalized.startsWith('1')) return '1';
    if (normalized.startsWith('N')) return 'N';
    if (normalized.startsWith('M')) return 'M';
    return undefined;
  };

  const normalizeScenarioAttributes = (value: unknown, max = 5) => {
    if (!Array.isArray(value)) return [];
    const attrs = value.filter((attr): attr is string => typeof attr === 'string');
    return normalizeAttributeList(attrs, max);
  };

  const buildAttributeNodes = (
    parentId: string,
    parentPosition: { x: number; y: number },
    attributes: string[],
    keyAttributes: string[],
    occupied: Array<{ type: NodeType; position: { x: number; y: number } }>,
    radiusX = 140,
    radiusY = 90,
  ) => {
    const keys = new Set(keyAttributes.map(attr => attr.toLowerCase()));
    const positions = placeAttributePositions(attributes, parentPosition, occupied, radiusX, radiusY);
    const attrNodes: ERNode[] = attributes.map((attr, index) => ({
      id: createId(),
      type: 'attribute',
      position: positions[index],
      label: attr,
      isKey: keys.has(attr.toLowerCase()),
      isMultivalued: false,
      isDerived: false,
    }));

    const attrConnections: Connection[] = attrNodes.map(attr => ({
      id: createId(),
      sourceId: parentId,
      targetId: attr.id,
      isTotalParticipation: false,
    }));

    return { attrNodes, attrConnections };
  };

  const inferScenarioWithAI = async (scenarioText: string): Promise<ScenarioModelNormalized | null> => {
    const hintsBlock = buildModelingHintsBlock();
    const prompt =
      `${SCENARIO_MASTER_GUIDE}\n` +
      `Extrae un modelo ER/EER del escenario.\n` +
      `Responde SOLO con JSON (una sola raíz) y sin markdown con esta forma:\n` +
      `{"entities":[{"name":"Profesor","attributes":["dni","nombre"],"key":"dni"}],` +
      `"relationships":[{"name":"Administra","participants":[{"entity":"Profesor","cardinality":"1","total":true,"role":"investigador_principal"},` +
      `{"entity":"Proyecto","cardinality":"N","total":true}],"attributes":["presupuesto"]}],` +
      `"isa":[{"supertype":"Persona","subtypes":["Profesor"],"disjoint":true,"total":false,"label":"ES"}],` +
      `"aggregations":[{"baseRelationship":"AsisteEn","memberEntities":["EstudianteGraduado","Proyecto"],"connectorRelationship":"Supervisa","mainEntity":"Profesor"}],` +
      `"notes":{"facts":["..."],"assumptions":["..."],"decisions":["..."],"checklist":["..."]}}\n` +
      `Reglas de salida:\n` +
      `- Modelo para graficar: entidades, relaciones, atributos, ISA y agregaciones (si aplica).\n` +
      `- Mantén consistencia semántica (no crear entidades ficticias).\n` +
      `- Usa snake_case en atributos.\n` +
      `- Cada entidad: máximo 5 atributos, con clave incluida.\n` +
      `- cardinality solo "1" o "N". total es boolean.\n` +
      `- Incluye roles cuando una entidad aparezca más de una vez en una relación.\n` +
      `- Si una relación necesita 3 participantes, úsala como n-aria en participants.\n` +
      `- Si una relación debe conectar una entidad con el vínculo entre otras entidades, usa aggregations.\n` +
      `- No devuelvas explicación fuera del JSON.\n` +
      hintsBlock +
      `Escenario: ${scenarioText}`;

    const aiText = await requestAIText(prompt);
    const json = extractJsonFromText(aiText) as ScenarioModel | null;
    const normalized = normalizeScenarioModelFromJson(json);
    if (!normalized) return null;

    const firstPass = sanitizeScenarioModel(normalized);
    if (firstPass.errors.length === 0) {
      return firstPass.model;
    }

    try {
      const repaired = await repairScenarioModelWithAI(scenarioText, aiText, firstPass.errors);
      if (repaired) {
        const secondPass = sanitizeScenarioModel(repaired);
        if (secondPass.model.entities.length > 0) {
          return secondPass.model;
        }
      }
    } catch {
      // ignore repair failures and fallback to deterministic sanitization
    }

    return firstPass.model.entities.length > 0 ? firstPass.model : null;
  };

  const buildDiagramFromScenario = (model: ScenarioModelNormalized) => {
    const { x: centerX, y: centerY } = getCanvasCenter();
    const center = { x: (centerX - offset.x) / scale, y: (centerY - offset.y) / scale };

    const uniqueEntities = new Map<string, { name: string; attributes: string[]; key?: string }>();
    model.entities.forEach(entity => {
      const label = normalizeEntityLabel(entity.name);
      if (!uniqueEntities.has(label.toLowerCase())) {
        uniqueEntities.set(label.toLowerCase(), { name: label, attributes: entity.attributes, key: entity.key });
      }
    });

    const entityEntries = Array.from(uniqueEntities.values());
    const nodes: ERNode[] = [];
    let connections: Connection[] = [];
    const scenarioAggregations: Aggregation[] = [];
    const occupiedNodes: ERNode[] = [];
    const entityMap = new Map<string, ERNode>();
    const entityIds = new Set<string>();
    const relationshipNodesByLabel = new Map<string, ERNode[]>();
    const relationshipEntityLinks = new Map<string, Set<string>>();
    const pendingEntityAttributes: Array<{
      parentId: string;
      parentPosition: { x: number; y: number };
      attributes: string[];
      keys: string[];
    }> = [];
    const pendingRelationshipAttributes: Array<{
      parentId: string;
      parentPosition: { x: number; y: number };
      attributes: string[];
    }> = [];

    const entityRadiusX = Math.max(300, 160 + entityEntries.length * 90);
    const entityRadiusY = Math.max(240, 120 + entityEntries.length * 70);

    entityEntries.forEach((entity, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(entityEntries.length, 1) - Math.PI / 2;
      const jitter = (index % 2 === 0 ? 1 : -1) * 20;
      const pos = {
        x: center.x + Math.cos(angle) * entityRadiusX + jitter,
        y: center.y + Math.sin(angle) * entityRadiusY - jitter * 0.5,
      };

      const normalizedAttributes = normalizeAttributeList(entity.attributes, 5);
      const { attributes: finalAttributes, keys } = ensureKeyAttribute(
        normalizedAttributes,
        entity.key ? [entity.key] : [],
        5
      );

      const entityNode: ERNode = {
        id: createId(),
        type: 'entity',
        position: pos,
        label: entity.name,
        isWeak: false,
      };

      entityMap.set(normalizeLabelForPreset(entity.name), entityNode);
      entityIds.add(entityNode.id);
      nodes.push(entityNode);
      occupiedNodes.push(entityNode);
      pendingEntityAttributes.push({
        parentId: entityNode.id,
        parentPosition: pos,
        attributes: finalAttributes,
        keys,
      });
    });

    const findFreePosition = (
      base: { x: number; y: number },
      type: NodeType,
      minGap = 24
    ) => {
      const expandRect = (node: { type: NodeType; position: { x: number; y: number } }) => {
        const rect = getNodeRect(node);
        return {
          x: rect.x - minGap,
          y: rect.y - minGap,
          w: rect.w + minGap * 2,
          h: rect.h + minGap * 2,
        };
      };
      const isFree = (pos: { x: number; y: number }) => {
        const candidateRect = expandRect({ type, position: pos });
        return occupiedNodes.every(existing => !rectsOverlap(candidateRect, expandRect(existing)));
      };
      if (isFree(base)) return base;
      for (let i = 1; i <= 42; i += 1) {
        const angle = i * 0.57;
        const radius = 80 + i * 18;
        const candidate = {
          x: base.x + Math.cos(angle) * radius,
          y: base.y + Math.sin(angle) * radius,
        };
        if (isFree(candidate)) return candidate;
      }
      return base;
    };

    const pairOffsets = new Map<string, number>();
    let nAryIndex = 0;

    model.relationships.forEach(rel => {
      const participants = rel.participants
        .map(participant => ({
          ...participant,
          entityKey: normalizeLabelForPreset(participant.entity),
        }))
        .filter(participant => entityMap.has(participant.entityKey));

      if (participants.length < 2) return;

      let base: { x: number; y: number };
      if (participants.length === 2) {
        const first = entityMap.get(participants[0].entityKey);
        const second = entityMap.get(participants[1].entityKey);
        if (!first || !second) return;
        const a = first.position;
        const b = second.position;
        const pairKey = [first.id, second.id].sort().join('|');
        const offsetIndex = pairOffsets.get(pairKey) ?? 0;
        pairOffsets.set(pairKey, offsetIndex + 1);

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const direction = offsetIndex % 2 === 0 ? 1 : -1;
        const distance = 80 + Math.floor(offsetIndex / 2) * 64;
        base = {
          x: (a.x + b.x) / 2 + nx * distance * direction,
          y: (a.y + b.y) / 2 + ny * distance * direction,
        };
      } else {
        const entityPositions = participants.map(participant => entityMap.get(participant.entityKey)!.position);
        const centroid = {
          x: entityPositions.reduce((sum, pos) => sum + pos.x, 0) / entityPositions.length,
          y: entityPositions.reduce((sum, pos) => sum + pos.y, 0) / entityPositions.length,
        };
        const angle = nAryIndex * 1.17;
        const distance = 85 + nAryIndex * 34;
        base = {
          x: centroid.x + Math.cos(angle) * distance,
          y: centroid.y + Math.sin(angle) * distance,
        };
        nAryIndex += 1;
      }

      const relPosition = findFreePosition(base, 'relationship', 28);

      const relNode: ERNode = {
        id: createId(),
        type: 'relationship',
        position: relPosition,
        label: normalizeEntityLabel(rel.name),
        isIdentifying: false,
      };
      nodes.push(relNode);
      occupiedNodes.push(relNode);
      const relKey = normalizeLabelForPreset(relNode.label);
      const relBucket = relationshipNodesByLabel.get(relKey) ?? [];
      relBucket.push(relNode);
      relationshipNodesByLabel.set(relKey, relBucket);

      const pairCount = new Map<string, number>();
      const linkedEntityIds = new Set<string>();

      participants.forEach(participant => {
        const entityNode = entityMap.get(participant.entityKey);
        if (!entityNode) return;
        const pairKey = `${relNode.id}-${entityNode.id}`;
        const count = pairCount.get(pairKey) ?? 0;
        if (count >= 2) return;
        pairCount.set(pairKey, count + 1);

        connections.push({
          id: createId(),
          sourceId: relNode.id,
          targetId: entityNode.id,
          cardinality: participant.cardinality ?? 'N',
          isTotalParticipation: participant.total ?? false,
          role: participant.role || undefined,
        });
        linkedEntityIds.add(entityNode.id);
      });

      relationshipEntityLinks.set(relNode.id, linkedEntityIds);

      if (rel.attributes.length > 0) {
        pendingRelationshipAttributes.push({
          parentId: relNode.id,
          parentPosition: relPosition,
          attributes: rel.attributes,
        });
      }
    });

    const getRelationshipNodeByLabel = (label: string | undefined) => {
      if (!label) return null;
      const key = normalizeLabelForPreset(label);
      const bucket = relationshipNodesByLabel.get(key);
      return bucket && bucket.length > 0 ? bucket[0] : null;
    };

    const hasDirectConnection = (aId: string, bId: string) =>
      connections.some(conn =>
        (conn.sourceId === aId && conn.targetId === bId) ||
        (conn.sourceId === bId && conn.targetId === aId)
      );

    model.isas.forEach((isa, index) => {
      const supertype = entityMap.get(normalizeLabelForPreset(isa.supertype));
      const subtypes = isa.subtypes
        .map(subtype => entityMap.get(normalizeLabelForPreset(subtype)))
        .filter((node): node is ERNode => !!node);

      if (!supertype || subtypes.length === 0) return;

      const subtypeCenter = subtypes.reduce(
        (acc, node) => ({ x: acc.x + node.position.x, y: acc.y + node.position.y }),
        { x: 0, y: 0 }
      );
      const avgSubtype = {
        x: subtypeCenter.x / subtypes.length,
        y: subtypeCenter.y / subtypes.length,
      };

      const isaBase = {
        x: (supertype.position.x + avgSubtype.x) / 2 + (index % 2 === 0 ? 28 : -28),
        y: (supertype.position.y + avgSubtype.y) / 2,
      };
      const isaPosition = findFreePosition(isaBase, 'isa', 24);
      const isaNode: ISANode = {
        id: createId(),
        type: 'isa',
        position: isaPosition,
        label: isa.label || 'ES',
        isDisjoint: isa.disjoint,
        isTotal: isa.total,
      };

      nodes.push(isaNode);
      occupiedNodes.push(isaNode);
      connections.push({
        id: createId(),
        sourceId: supertype.id,
        targetId: isaNode.id,
        isTotalParticipation: isa.total,
      });

      subtypes.forEach(subtype => {
        connections.push({
          id: createId(),
          sourceId: isaNode.id,
          targetId: subtype.id,
          isTotalParticipation: false,
        });
      });
    });

    model.aggregations.forEach(aggregation => {
      const memberIds = new Set<string>();
      const memberEntityIds = aggregation.memberEntities
        .map(entityName => entityMap.get(normalizeLabelForPreset(entityName)))
        .filter((node): node is ERNode => !!node)
        .map(node => node.id);
      memberEntityIds.forEach(id => memberIds.add(id));

      const baseRelationshipNode = getRelationshipNodeByLabel(aggregation.baseRelationship);
      if (baseRelationshipNode) {
        memberIds.add(baseRelationshipNode.id);
        const linkedEntities = relationshipEntityLinks.get(baseRelationshipNode.id);
        linkedEntities?.forEach(id => memberIds.add(id));
      }

      if (!baseRelationshipNode || memberIds.size < 2) return;

      const aggregationItem: Aggregation = {
        id: createId(),
        memberIds: Array.from(memberIds),
        label: aggregation.label,
      };
      scenarioAggregations.push(aggregationItem);

      const connectorRelationshipNode = getRelationshipNodeByLabel(aggregation.connectorRelationship);
      const mainEntityNode = aggregation.mainEntity
        ? entityMap.get(normalizeLabelForPreset(aggregation.mainEntity))
        : null;

      if (!connectorRelationshipNode || !mainEntityNode) return;

      const removableMembers = new Set(
        Array.from(memberIds).filter(id => id !== mainEntityNode.id && entityIds.has(id))
      );
      connections = connections.filter(conn => {
        const touchesConnector =
          conn.sourceId === connectorRelationshipNode.id || conn.targetId === connectorRelationshipNode.id;
        if (!touchesConnector) return true;
        const otherId = conn.sourceId === connectorRelationshipNode.id ? conn.targetId : conn.sourceId;
        if (otherId === mainEntityNode.id) return true;
        if (removableMembers.has(otherId)) return false;
        return true;
      });

      if (!hasDirectConnection(connectorRelationshipNode.id, mainEntityNode.id)) {
        connections.push({
          id: createId(),
          sourceId: connectorRelationshipNode.id,
          targetId: mainEntityNode.id,
          isTotalParticipation: false,
        });
      }
      if (!hasDirectConnection(connectorRelationshipNode.id, aggregationItem.id)) {
        connections.push({
          id: createId(),
          sourceId: connectorRelationshipNode.id,
          targetId: aggregationItem.id,
          isTotalParticipation: false,
        });
      }
    });

    pendingEntityAttributes.forEach(entry => {
      const { attrNodes, attrConnections } = buildAttributeNodes(
        entry.parentId,
        entry.parentPosition,
        entry.attributes,
        entry.keys,
        occupiedNodes,
        180,
        120
      );
      nodes.push(...attrNodes);
      connections.push(...attrConnections);
      occupiedNodes.push(...attrNodes);
    });

    pendingRelationshipAttributes.forEach(entry => {
      const { attrNodes, attrConnections } = buildAttributeNodes(
        entry.parentId,
        entry.parentPosition,
        entry.attributes,
        [],
        occupiedNodes,
        150,
        100
      );
      nodes.push(...attrNodes);
      connections.push(...attrConnections);
      occupiedNodes.push(...attrNodes);
    });

    const resolveCollisions = (inputNodes: ERNode[]) => {
      const adjusted = inputNodes.map(node => ({ ...node, position: { ...node.position } }));
      for (let iteration = 0; iteration < 120; iteration += 1) {
        let moved = false;
        for (let i = 0; i < adjusted.length; i += 1) {
          for (let j = i + 1; j < adjusted.length; j += 1) {
            const a = adjusted[i];
            const b = adjusted[j];
            const gap = a.type === 'attribute' || b.type === 'attribute' ? 14 : 24;
            const rectA = getNodeRect(a);
            const rectB = getNodeRect(b);
            const expandedA = { x: rectA.x - gap, y: rectA.y - gap, w: rectA.w + gap * 2, h: rectA.h + gap * 2 };
            const expandedB = { x: rectB.x - gap, y: rectB.y - gap, w: rectB.w + gap * 2, h: rectB.h + gap * 2 };
            if (!rectsOverlap(expandedA, expandedB)) continue;

            let dx = b.position.x - a.position.x;
            let dy = b.position.y - a.position.y;
            if (dx === 0 && dy === 0) {
              dx = 1;
              dy = 0;
            }
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const overlapX = Math.min(expandedA.x + expandedA.w, expandedB.x + expandedB.w) - Math.max(expandedA.x, expandedB.x);
            const overlapY = Math.min(expandedA.y + expandedA.h, expandedB.y + expandedB.h) - Math.max(expandedA.y, expandedB.y);
            const push = Math.max(1, Math.min(overlapX, overlapY) / 2 + 1.5);

            const aLocked = entityIds.has(a.id);
            const bLocked = entityIds.has(b.id);
            if (aLocked && bLocked) continue;
            if (aLocked && !bLocked) {
              b.position.x += ux * push * 2;
              b.position.y += uy * push * 2;
              moved = true;
              continue;
            }
            if (!aLocked && bLocked) {
              a.position.x -= ux * push * 2;
              a.position.y -= uy * push * 2;
              moved = true;
              continue;
            }
            a.position.x -= ux * push;
            a.position.y -= uy * push;
            b.position.x += ux * push;
            b.position.y += uy * push;
            moved = true;
          }
        }
        if (!moved) break;
      }
      return adjusted;
    };

    return { nodes: resolveCollisions(nodes), connections, aggregations: scenarioAggregations };
  };

  const exportPresets = () => {
    const json = JSON.stringify(attributePresets, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'derup-presets.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPresetsClick = () => {
    presetFileInputRef.current?.click();
  };

  const handleImportPresets = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, { label?: string; attributes?: unknown }>;
      if (!parsed || typeof parsed !== 'object') {
        alert('Formato de presets inválido.');
        return;
      }

      const merged: Record<string, { label: string; attributes: string[] }> = { ...attributePresets };
      Object.entries(parsed).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        const label = typeof value.label === 'string' ? value.label : key;
        const attributes = Array.isArray(value.attributes) ? value.attributes.filter(attr => typeof attr === 'string') : [];
        if (!label || attributes.length === 0) return;
        const normalized = normalizeAttributeList(attributes, 5);
        const { attributes: finalAttributes } = ensureKeyAttribute(normalized, ['id'], 5);
        merged[normalizeLabelForPreset(label)] = {
          label: label.trim(),
          attributes: finalAttributes,
        };
      });
      setAttributePresets(merged);
      alert('Presets importados.');
    } catch {
      alert('No se pudo importar el archivo de presets.');
    }
  };

  const getNodeSize = (type: NodeType) => {
    switch (type) {
      case 'entity':
        return { width: 100, height: 50 };
      case 'relationship':
        return { width: 100, height: 60 };
      case 'attribute':
        return { width: 80, height: 40 };
      case 'isa':
      default:
        return { width: 70, height: 60 };
    }
  };

  const getNodeRect = (node: { type: NodeType; position: { x: number; y: number } }) => {
    const size = getNodeSize(node.type);
    return {
      x: node.position.x - size.width / 2,
      y: node.position.y - size.height / 2,
      w: size.width,
      h: size.height,
    };
  };

  const rectsOverlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ) =>
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;

  const positionOverlaps = (
    pos: { x: number; y: number },
    type: NodeType,
    occupied: Array<{ type: NodeType; position: { x: number; y: number } }>
  ) => {
    const rect = getNodeRect({ type, position: pos });
    return occupied.some(node => rectsOverlap(rect, getNodeRect(node)));
  };

  const placeAttributePositions = (
    attributes: string[],
    parentPosition: { x: number; y: number },
    occupied: Array<{ type: NodeType; position: { x: number; y: number } }>,
    radiusX = 150,
    radiusY = 90
  ) => {
    const count = attributes.length;
    const placed: Array<{ type: NodeType; position: { x: number; y: number } }> = [];
    const positions: Array<{ x: number; y: number }> = [];

    for (let index = 0; index < count; index += 1) {
      let angle = count > 0 ? (Math.PI * 2 * index) / count : 0;
      let rx = radiusX;
      let ry = radiusY;
      let candidate = {
        x: parentPosition.x + Math.cos(angle) * rx,
        y: parentPosition.y + Math.sin(angle) * ry,
      };

      for (let attempt = 0; attempt < 18; attempt += 1) {
        if (!positionOverlaps(candidate, 'attribute', [...occupied, ...placed])) {
          break;
        }
        angle += 0.35;
        rx += 12;
        ry += 9;
        candidate = {
          x: parentPosition.x + Math.cos(angle) * rx,
          y: parentPosition.y + Math.sin(angle) * ry,
        };
      }

      positions.push(candidate);
      placed.push({ type: 'attribute', position: candidate });
    }

    return positions;
  };

  const findAvailablePosition = (base: { x: number; y: number }) => {
    const margin = 24;
    const newSize = getNodeSize('entity');
    const isFree = (pos: { x: number; y: number }) => {
      const newBox = {
        x: pos.x - newSize.width / 2 - margin,
        y: pos.y - newSize.height / 2 - margin,
        w: newSize.width + margin * 2,
        h: newSize.height + margin * 2,
      };
      return nodes.every(node => {
        const size = getNodeSize(node.type);
        const box = {
          x: node.position.x - size.width / 2,
          y: node.position.y - size.height / 2,
          w: size.width,
          h: size.height,
        };
        const overlap =
          newBox.x < box.x + box.w &&
          newBox.x + newBox.w > box.x &&
          newBox.y < box.y + box.h &&
          newBox.y + newBox.h > box.y;
        return !overlap;
      });
    };

    if (isFree(base)) return base;
    for (let i = 1; i <= 40; i += 1) {
      const angle = i * 0.65;
      const radius = 80 + i * 18;
      const candidate = {
        x: base.x + Math.cos(angle) * radius,
        y: base.y + Math.sin(angle) * radius,
      };
      if (isFree(candidate)) return candidate;
    }
    return base;
  };

  const addEntityWithAttributes = (
    entityName: string,
    attributes: string[],
    keyAttributes: string[],
  ) => {
    const entityId = createId();
    const entityLabel = normalizeEntityLabel(entityName);

    const { x: centerX, y: centerY } = getCanvasCenter();
    const basePos = { x: (centerX - offset.x) / scale, y: (centerY - offset.y) / scale };
    const entityPos = findAvailablePosition(basePos);

    const newEntity: ERNode = {
      id: entityId,
      type: 'entity',
      position: entityPos,
      label: entityLabel,
      isWeak: false,
    };

    const filteredAttributes = normalizeAttributeList(attributes, 5);
    const keys = new Set(keyAttributes.map(attr => attr.toLowerCase()));

    const { attrNodes: newAttributes, attrConnections: newConnections } = buildAttributeNodes(
      entityId,
      entityPos,
      filteredAttributes,
      Array.from(keys),
      [...nodes, newEntity],
      150,
      90
    );

    setNodes(prev => [...prev, newEntity, ...newAttributes]);
    setConnections(prev => [...prev, ...newConnections]);
    setSelectedNodeIds(new Set([entityId]));
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());

    return {
      attributes: filteredAttributes,
      keys: Array.from(keys),
    };
  };

  const normalizeForEntityMatch = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const findEntityByLabel = (label: string | null) => {
    if (!label) return null;
    const target = normalizeForEntityMatch(label);
    const node = nodes.find(n => n.type === 'entity' && normalizeForEntityMatch(n.label) === target);
    return (node && node.type === 'entity') ? node : null;
  };

  const getSelectedEntity = () => {
    if (selectedNodeIds.size === 1) {
      const selectedId = Array.from(selectedNodeIds)[0];
      const node = nodes.find(n => n.id === selectedId);
      if (node && node.type === 'entity') return node;
    }
    if (lastSelectedNodeId) {
      const node = nodes.find(n => n.id === lastSelectedNodeId);
      if (node && node.type === 'entity') return node;
    }
    return null;
  };

  const cleanParsedAttributeInputs = (attributes: string[]) =>
    attributes
      .map(attr => attr.trim())
      .map(attr => attr.replace(/^(los?|las?)\s+atribut\w*\s*(de|a)?\s*/i, '').trim())
      .filter(attr => attr.length > 0)
      .filter(attr => !/^a\s+(la|esta)\s+entidad\b/i.test(attr))
      .filter(attr => !/^(la\s+)?entidad\b/i.test(attr))
      .filter(attr => !/^(de|para|en)\s+la\s+entidad\b/i.test(attr))
      .filter(attr => !/^(este|esta)\s+entidad\b/i.test(attr));

  const addAttributesToExistingEntity = (
    entity: EntityNode,
    rawAttributes: string[],
    keyAttributes: string[]
  ) => {
    const cleaned = cleanParsedAttributeInputs(rawAttributes);
    const normalized = normalizeAttributeList(cleaned, 12);

    const connectedAttributeIds = new Set(
      connections
        .filter(conn => conn.sourceId === entity.id || conn.targetId === entity.id)
        .map(conn => (conn.sourceId === entity.id ? conn.targetId : conn.sourceId))
    );

    const existingAttributes = nodes.filter(
      node => node.type === 'attribute' && connectedAttributeIds.has(node.id)
    );
    const existingNames = new Set(existingAttributes.map(attr => attr.label.toLowerCase()));
    const attrsToAdd = normalized.filter(attr => !existingNames.has(attr.toLowerCase()));

    if (attrsToAdd.length === 0) {
      return { added: [] as string[], skipped: normalized };
    }

    const keySet = new Set(keyAttributes.map(key => key.toLowerCase()));
    const positions = placeAttributePositions(attrsToAdd, entity.position, nodes, 150, 90);
    const newAttributes: ERNode[] = attrsToAdd.map((attr, index) => ({
      id: createId(),
      type: 'attribute',
      position: positions[index],
      label: attr,
      isKey: keySet.has(attr.toLowerCase()),
      isMultivalued: false,
      isDerived: false,
    }));

    const newConnections: Connection[] = newAttributes.map(attr => ({
      id: createId(),
      sourceId: entity.id,
      targetId: attr.id,
      isTotalParticipation: false,
    }));

    setNodes(prev => [...prev, ...newAttributes]);
    setConnections(prev => [...prev, ...newConnections]);
    setSelectedNodeIds(new Set([entity.id]));
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());

    return { added: attrsToAdd, skipped: normalized.filter(attr => existingNames.has(attr.toLowerCase())) };
  };

  const entityNames = useMemo(() => nodes.filter(n => n.type === 'entity').map(n => n.label), [nodes]);

  const updateChatSuggestions = (value: string) => {
    setChatInput(value);
    setChatSuggestionIndex(-1);
    // Extract the last word being typed
    const words = value.split(/\s+/);
    const lastWord = words[words.length - 1]?.toLowerCase() || '';
    if (lastWord.length < 1) {
      setChatSuggestions([]);
      return;
    }
    const matches = entityNames.filter(name =>
      name.toLowerCase().startsWith(lastWord) && name.toLowerCase() !== lastWord
    );
    setChatSuggestions(matches.slice(0, 5));
  };

  const applySuggestion = (suggestion: string) => {
    const words = chatInput.split(/\s+/);
    words[words.length - 1] = suggestion;
    setChatInput(words.join(' ') + ' ');
    setChatSuggestions([]);
    setChatSuggestionIndex(-1);
    chatInputRef.current?.focus();
  };

  // Connect to room from URL on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('room');
    if (rid) joinRoom(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinRoom = (rid: string) => {
    if (wsRef.current) wsRef.current.close();
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/?room=${rid}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setRoomId(rid);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { type: string; nodes?: ERNode[]; connections?: Connection[]; aggregations?: Aggregation[] };
      if (msg.type === 'state' || msg.type === 'update') {
        isSyncingRef.current = true;
        if (Array.isArray(msg.nodes)) setNodes(msg.nodes);
        if (Array.isArray(msg.connections)) setConnections(msg.connections);
        if (Array.isArray(msg.aggregations)) setAggregations(msg.aggregations);
        setTimeout(() => { isSyncingRef.current = false; }, 0);
      }
    };

    ws.onclose = () => {
      setRoomId(prev => (prev === rid ? null : prev));
    };
  };

  const leaveRoom = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setRoomId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  };

  const createRoom = async () => {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const data = await res.json() as { roomId: string };
    const url = new URL(window.location.href);
    url.searchParams.set('room', data.roomId);
    window.history.replaceState({}, '', url.toString());
    joinRoom(data.roomId);
  };

  const sendUpdateDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isSyncingRef.current) return;
    if (sendUpdateDebounceRef.current) clearTimeout(sendUpdateDebounceRef.current);
    sendUpdateDebounceRef.current = window.setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'update', nodes, connections, aggregations }));
      }
    }, 150);
  }, [nodes, connections, aggregations, roomId]);

  const handleChatSubmit = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatSuggestions([]);
    setChatSuggestionIndex(-1);

    const userMessage = { id: createId(), role: 'user' as const, text };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');

    const normalizedText = text.toLowerCase().trim();
    if (normalizedText === 'ver reglas' || normalizedText === 'ver hints') {
      const reply = modelingHints.length > 0
        ? `Reglas activas:\n- ${modelingHints.join('\n- ')}`
        : 'No hay reglas guardadas. Usa "regla: <tu instrucción>" para agregar una.';
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: reply }]);
      return;
    }

    if (normalizedText === 'limpiar reglas' || normalizedText === 'borrar reglas') {
      setModelingHints([]);
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: 'Listo. Limpié las reglas guardadas.' }]);
      return;
    }

    const hintMatch = text.match(/^(?:regla|correcci[oó]n|hint)\s*[:−-]\s*(.+)$/i);
    if (hintMatch) {
      const hint = hintMatch[1].trim().replace(/\s+/g, ' ');
      if (!hint) {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: 'La regla está vacía. Escribe: regla: <instrucción>' }]);
        return;
      }
      setModelingHints(prev => {
        const exists = prev.some(item => item.toLowerCase() === hint.toLowerCase());
        if (exists) return prev;
        return [hint, ...prev].slice(0, 20);
      });
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Regla guardada para próximos escenarios: "${hint}"` }]);
      return;
    }

    const entityLabels = nodes.filter(n => n.type === 'entity').map(n => n.label);
    const explicitCommandIntent = /\b(agregar|crear|añadir|anadir|add|create)\b/i.test(text);
    const scenarioDetected = looksLikeScenario(text) && !explicitCommandIntent;
    let parsed = scenarioDetected ? null : parseChatCommand(text, entityLabels);
    let aiResponseText = '';

    if (scenarioDetected) {
      if (!aiEnabled) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'Para interpretar un escenario completo necesito que actives la IA.',
          }
        ]);
        return;
      }
      if (providerNeedsApiKey(aiProvider) && !getProviderApiKey(aiProvider)) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `Ingresa tu API Key de ${getProviderLabel(aiProvider)} para continuar.`,
          }
        ]);
        return;
      }
      if (!aiModel.trim()) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'Configura el modelo de IA antes de usar el chat inteligente.',
          }
        ]);
        return;
      }

      setAiStatus('thinking');
      try {
        const scenarioModel = await inferScenarioWithAI(text);
        if (!scenarioModel) {
          setChatMessages(prev => [
            ...prev,
            {
              id: createId(),
              role: 'assistant',
              text: 'No pude interpretar el escenario. Prueba con un texto más directo o vuelve a intentar.',
            }
          ]);
          return;
        }

        const { nodes: scenarioNodes, connections: scenarioConnections, aggregations: scenarioAggregations } = buildDiagramFromScenario({
          entities: scenarioModel.entities,
          relationships: scenarioModel.relationships,
          isas: scenarioModel.isas,
          aggregations: scenarioModel.aggregations,
        });

        setNodes(scenarioNodes);
        setConnections(scenarioConnections);
        setAggregations(scenarioAggregations);
        setSelectedNodeIds(new Set());
        setSelectedConnectionIds(new Set());
        setSelectedAggregationIds(new Set());
        setLastSelectedNodeId(null);

        const nextPresets = { ...attributePresets };
        scenarioModel.entities.forEach(entity => {
          if (!entity.name) return;
          const normalizedAttributes = normalizeAttributeList(entity.attributes, 5);
          const { attributes: finalAttributes } = ensureKeyAttribute(
            normalizedAttributes,
            entity.key ? [entity.key] : [],
            5
          );
          nextPresets[normalizeLabelForPreset(entity.name)] = {
            label: normalizeEntityLabel(entity.name),
            attributes: finalAttributes,
          };
        });
        setAttributePresets(nextPresets);

        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'Listo. Generé el modelo completo del escenario y lo dibujé en el lienzo.',
          }
        ]);
      } catch (error) {
        const fallbackNote = lastAIFallbackFrom ? ` (fallback desde ${getProviderLabel(lastAIFallbackFrom)})` : '';
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `${describeAIError(error, aiProvider)}${fallbackNote}`,
          }
        ]);
      } finally {
        setAiStatus('idle');
      }
      return;
    }

    if (!parsed && aiEnabled) {
      if (providerNeedsApiKey(aiProvider) && !getProviderApiKey(aiProvider)) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `Ingresa tu API Key de ${getProviderLabel(aiProvider)} para continuar.`,
          }
        ]);
        return;
      }
      if (!aiModel.trim()) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'Configura el modelo de IA antes de usar el chat inteligente.',
          }
        ]);
        return;
      }

      setAiStatus('thinking');
      try {
        const entityHint = entityLabels.length > 0 ? `Entidades actuales en el diagrama: ${entityLabels.join(', ')}.\n` : '';
        const prompt = `Eres el asistente de derup, una herramienta de modelado entidad-relación (ER/EER).\n` +
          `${entityHint}\n` +
          `Tu única función es ayudar al usuario a construir diagramas ER. Respondé siempre en español.\n` +
          `\n` +
          `Si el mensaje del usuario es un comando de modelado ER, respondé SOLO con una línea en este formato exacto (sin comillas, sin explicación):\n` +
          `- Crear entidad: "agregar una entidad <Nombre> con atributos: a, b, c donde <clave> es clave"\n` +
          `- Agregar atributos: "agrega atributos: a, b, c a la entidad <Nombre>"\n` +
          `- Conectar entidades: "vincula la entidad <A> con la entidad <B> relacion <Nombre>"\n` +
          `- Agregar agregación: "la relacion <R> debe relacionar <Entidad> con una agregacion entre <A> y <B>"\n` +
          `\n` +
          `Si el mensaje NO es un comando ER (saludo, pregunta, consulta general), respondé en lenguaje natural guiando al usuario.\n` +
          `Explicá qué puede hacer en derup: crear entidades, agregar atributos, vincular entidades, crear relaciones, agregaciones.\n` +
          `Sé breve, amigable y siempre terminá sugiriendo una acción concreta que puede realizar.\n` +
          `\n` +
          `Usuario: ${text}`;
        const aiText = await requestAIText(prompt);
        aiResponseText = aiText ?? '';
        if (aiResponseText) {
          parsed = parseChatCommand(aiResponseText, entityLabels);
        }
      } catch (error) {
        const fallbackNote = lastAIFallbackFrom ? ` (fallback desde ${getProviderLabel(lastAIFallbackFrom)})` : '';
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `${describeAIError(error, aiProvider)}${fallbackNote}`,
          }
        ]);
        setAiStatus('idle');
        return;
      } finally {
        setAiStatus('idle');
      }
    }
    if (!parsed) {
      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: aiResponseText || 'Podés pedirme: crear entidades, agregar atributos, vincular entidades o crear relaciones. ¿Qué querés modelar?'
        }
      ]);
      return;
    }

    if (parsed.type === 'add-attributes') {
      const targetEntity = parsed.entityName === '__selected__'
        ? getSelectedEntity()
        : findEntityByLabel(parsed.entityName);

      if (!targetEntity) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'No encontré la entidad. Prueba con "agrega atributos: campo1, campo2 a la entidad Profesor" o selecciona la entidad y usa "a esta entidad".'
          }
        ]);
        return;
      }

      const cleanedInput = cleanParsedAttributeInputs(parsed.attributes);
      if (cleanedInput.length === 0) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `No detecté atributos válidos para ${targetEntity.label}. Ejemplo: "agrega atributos: telefono, jerarquia a la entidad ${targetEntity.label}".`
          }
        ]);
        return;
      }

      const { added, skipped } = addAttributesToExistingEntity(targetEntity, cleanedInput, parsed.keyAttributes);
      if (added.length === 0) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `No agregué atributos nuevos: ${targetEntity.label} ya tiene esos atributos.`
          }
        ]);
        return;
      }

      const skippedText = skipped.length > 0 ? ` Omitidos por repetidos: ${skipped.join(', ')}.` : '';
      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: `Listo. Agregué a ${targetEntity.label} los atributos: ${added.join(', ')}.${skippedText}`
        }
      ]);
      return;
    }

    if (parsed.type === 'connect-entity-aggregation') {
      const mainEntity = findEntityByLabel(parsed.entityName);
      const aggregationEntityA = findEntityByLabel(parsed.aggregationEntityA);
      const aggregationEntityB = findEntityByLabel(parsed.aggregationEntityB);

      if (!mainEntity || !aggregationEntityA || !aggregationEntityB) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'No pude resolver las entidades para la agregación. Verifica los nombres de entidad.'
          }
        ]);
        return;
      }

      if (aggregationEntityA.id === aggregationEntityB.id || mainEntity.id === aggregationEntityA.id || mainEntity.id === aggregationEntityB.id) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'La agregación debe usar dos entidades distintas y distintas de la entidad principal.'
          }
        ]);
        return;
      }

      const normalize = (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();

      const hasDirectConnection = (aId: string, bId: string, items: Connection[]) =>
        items.some(conn =>
          (conn.sourceId === aId && conn.targetId === bId) ||
          (conn.sourceId === bId && conn.targetId === aId)
        );

      const relationshipLabel = parsed.relationshipName ? normalizeEntityLabel(parsed.relationshipName) : 'Relación';
      let nextNodes = [...nodes];
      let nextAggregations = [...aggregations];
      let nextConnections = [...connections];

      const bridgeRelationship = nextNodes.find(node => {
        if (node.type !== 'relationship') return false;
        return (
          hasDirectConnection(node.id, aggregationEntityA.id, nextConnections) &&
          hasDirectConnection(node.id, aggregationEntityB.id, nextConnections)
        );
      });

      const requiredMemberIds = new Set<string>([
        aggregationEntityA.id,
        aggregationEntityB.id,
      ]);
      if (bridgeRelationship) {
        requiredMemberIds.add(bridgeRelationship.id);
      }

      let aggregation = nextAggregations.find(item =>
        Array.from(requiredMemberIds).every(memberId => item.memberIds.includes(memberId))
      );
      if (!aggregation) {
        aggregation = {
          id: createId(),
          memberIds: Array.from(requiredMemberIds),
        };
        nextAggregations = [...nextAggregations, aggregation];
      }

      let relationshipNode = parsed.relationshipName
        ? nextNodes.find(node => node.type === 'relationship' && normalize(node.label) === normalize(relationshipLabel))
        : null;

      if (!relationshipNode) {
        const memberPositions = Array.from(requiredMemberIds)
          .map(memberId => nextNodes.find(node => node.id === memberId))
          .filter((node): node is ERNode => !!node)
          .map(node => node.position);

        const aggregationCenter = memberPositions.length > 0
          ? {
            x: memberPositions.reduce((sum, pos) => sum + pos.x, 0) / memberPositions.length,
            y: memberPositions.reduce((sum, pos) => sum + pos.y, 0) / memberPositions.length,
          }
          : aggregationEntityA.position;

        relationshipNode = {
          id: createId(),
          type: 'relationship',
          position: {
            x: (mainEntity.position.x + aggregationCenter.x) / 2,
            y: (mainEntity.position.y + aggregationCenter.y) / 2,
          },
          label: relationshipLabel,
          isIdentifying: false,
        };
        nextNodes = [...nextNodes, relationshipNode];
      }

      nextConnections = nextConnections.filter(conn => {
        const touchesRelationship =
          conn.sourceId === relationshipNode.id || conn.targetId === relationshipNode.id;
        if (!touchesRelationship) return true;
        const otherId = conn.sourceId === relationshipNode.id ? conn.targetId : conn.sourceId;
        if (otherId === mainEntity.id) return true;
        if (otherId === aggregation.id) return true;
        if (requiredMemberIds.has(otherId)) return false;
        return true;
      });

      if (!hasDirectConnection(relationshipNode.id, mainEntity.id, nextConnections)) {
        nextConnections = [
          ...nextConnections,
          {
            id: createId(),
            sourceId: relationshipNode.id,
            targetId: mainEntity.id,
            isTotalParticipation: false,
          },
        ];
      }
      if (!hasDirectConnection(relationshipNode.id, aggregation.id, nextConnections)) {
        nextConnections = [
          ...nextConnections,
          {
            id: createId(),
            sourceId: relationshipNode.id,
            targetId: aggregation.id,
            isTotalParticipation: false,
          },
        ];
      }

      setNodes(nextNodes);
      setAggregations(nextAggregations);
      setConnections(nextConnections);
      setSelectedNodeIds(new Set([relationshipNode.id]));
      setSelectedAggregationIds(new Set([aggregation.id]));
      setSelectedConnectionIds(new Set());

      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: `Listo. Ajusté ${relationshipNode.label} para relacionar ${mainEntity.label} con la agregación entre ${aggregationEntityA.label} y ${aggregationEntityB.label}.`
        }
      ]);
      return;
    }

    if (parsed.type === 'add-entity') {
      const useDefault = parsed.useDefaultAttributes || parsed.attributes.length === 0;
      let resolvedAttributesRaw = parsed.attributes;
      let keyCandidates = parsed.keyAttributes;
      let inferredByAI = false;

      if (useDefault) {
        if (aiEnabled) {
          if (providerNeedsApiKey(aiProvider) && !getProviderApiKey(aiProvider)) {
            setChatMessages(prev => [
              ...prev,
              {
                id: createId(),
                role: 'assistant',
                text: `Ingresa tu API Key de ${getProviderLabel(aiProvider)} para continuar.`,
              }
            ]);
            return;
          }
          setAiStatus('thinking');
          try {
            const aiResult = await inferAttributesWithAI(parsed.entityName);
            if (aiResult) {
              resolvedAttributesRaw = aiResult.attributes;
              keyCandidates = [aiResult.key];
              inferredByAI = true;
            }
          } catch {
            // ignore AI errors and fallback
          } finally {
            setAiStatus('idle');
          }
        }
      }

      if (resolvedAttributesRaw.length === 0) {
        resolvedAttributesRaw = getDefaultAttributesForEntity(normalizeEntityLabel(parsed.entityName));
      }

      const normalizedAttributes = normalizeAttributeList(resolvedAttributesRaw, 5);
      const { attributes: finalAttributes, keys: keyList } = ensureKeyAttribute(
        normalizedAttributes,
        keyCandidates,
        5
      );

      if (!getPresetAttributesForEntity(parsed.entityName)) {
        upsertPreset(normalizeEntityLabel(parsed.entityName), finalAttributes);
      } else if (inferredByAI) {
        upsertPreset(normalizeEntityLabel(parsed.entityName), finalAttributes);
      }

      addEntityWithAttributes(parsed.entityName, finalAttributes, keyList);
      const keyText = keyList.length > 0 ? ` (clave: ${keyList.join(', ')})` : '';
      const attrsText = finalAttributes.length > 0 ? ` con atributos ${finalAttributes.join(', ')}` : '';
      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: `Listo. Agregué la entidad ${normalizeEntityLabel(parsed.entityName)}${attrsText}${keyText}.`,
        }
      ]);
      return;
    }

    if (parsed.type === 'connect-entities') {
      const normalize = (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();

      const findEntityByLabel = (label: string | null) => {
        if (!label) return null;
        const target = normalize(label);
        return nodes.find(n => n.type === 'entity' && normalize(n.label) === target) ?? null;
      };

      const selectedEntity = (() => {
        if (selectedNodeIds.size === 1) {
          const selectedId = Array.from(selectedNodeIds)[0];
          const node = nodes.find(n => n.id === selectedId);
          if (node && node.type === 'entity') return node;
        }
        if (lastSelectedNodeId) {
          const node = nodes.find(n => n.id === lastSelectedNodeId);
          if (node && node.type === 'entity') return node;
        }
        return null;
      })();

      const entityA = parsed.entityA === '__selected__' ? selectedEntity : findEntityByLabel(parsed.entityA);
      const entityB = parsed.entityB === '__selected__' ? selectedEntity : findEntityByLabel(parsed.entityB);

      if (!entityA || !entityB) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'No encontré ambas entidades. Selecciona una entidad y prueba "vincula esta entidad con la entidad Course".'
          }
        ]);
        return;
      }

      if (entityA.id === entityB.id) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'Selecciona dos entidades distintas para crear la relación.'
          }
        ]);
        return;
      }

      const relId = createId();
      const midX = (entityA.position.x + entityB.position.x) / 2;
      const midY = (entityA.position.y + entityB.position.y) / 2;

      const relationshipLabel = parsed.relationshipName ? normalizeEntityLabel(parsed.relationshipName) : 'Relación';
      const relationshipNode: ERNode = {
        id: relId,
        type: 'relationship',
        position: { x: midX, y: midY },
        label: relationshipLabel,
        isIdentifying: false,
      };

      const newConnections: Connection[] = [
        {
          id: createId(),
          sourceId: entityA.id,
          targetId: relId,
          isTotalParticipation: false,
        },
        {
          id: createId(),
          sourceId: relId,
          targetId: entityB.id,
          isTotalParticipation: false,
        },
      ];

      setNodes(prev => [...prev, relationshipNode]);
      setConnections(prev => [...prev, ...newConnections]);
      setSelectedNodeIds(new Set([relId]));
      setSelectedConnectionIds(new Set());
      setSelectedAggregationIds(new Set());

      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: `Listo. Creé la relación ${relationshipLabel} entre ${entityA.label} y ${entityB.label}.`
        }
      ]);
      return;
    }

    if (parsed.type === 'set-entity-weakness') {
      const normalize = (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();

      const findEntityByLabel = (label: string | null) => {
        if (!label) return null;
        const target = normalize(label);
        return nodes.find(n => n.type === 'entity' && normalize(n.label) === target) ?? null;
      };

      const selectedEntity = (() => {
        if (selectedNodeIds.size === 1) {
          const selectedId = Array.from(selectedNodeIds)[0];
          const node = nodes.find(n => n.id === selectedId);
          if (node && node.type === 'entity') return node;
        }
        if (lastSelectedNodeId) {
          const node = nodes.find(n => n.id === lastSelectedNodeId);
          if (node && node.type === 'entity') return node;
        }
        return null;
      })();

      const entity = parsed.entityName === '__selected__' ? selectedEntity : findEntityByLabel(parsed.entityName);
      if (!entity) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: 'No encontré la entidad. Selecciona una entidad y prueba "esta entidad es débil".'
          }
        ]);
        return;
      }

      updateNode(entity.id, { isWeak: parsed.isWeak });
      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: `Listo. La entidad ${entity.label} ahora es ${parsed.isWeak ? 'débil' : 'fuerte'}.`
        }
      ]);
      return;
    }

    if (parsed.type === 'clear-diagram') {
      setNodes([]);
      setConnections([]);
      setAggregations([]);
      setSelectedNodeIds(new Set());
      setSelectedConnectionIds(new Set());
      setSelectedAggregationIds(new Set());
      setLastSelectedNodeId(null);
      setChatMessages(prev => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          text: 'Listo. Eliminé todo el diagrama.'
        }
      ]);
      return;
    }
  };

  const createHierarchy = () => {
    const selectedEntities = nodes.filter(
      (n): n is EntityNode => selectedNodeIds.has(n.id) && n.type === 'entity'
    );
    if (selectedEntities.length < 2) {
      alert('Selecciona al menos dos entidades para crear una jerarquía.');
      return;
    }

    const supertype =
      selectedEntities.find(n => n.id === lastSelectedNodeId) ?? selectedEntities[0];
    const subtypes = selectedEntities.filter(n => n.id !== supertype.id);
    if (subtypes.length === 0) {
      alert('Selecciona al menos una subentidad.');
      return;
    }

    const subtypeCenter = subtypes.reduce(
      (acc, node) => ({ x: acc.x + node.position.x, y: acc.y + node.position.y }),
      { x: 0, y: 0 }
    );
    const subX = subtypeCenter.x / subtypes.length;
    const subY = subtypeCenter.y / subtypes.length;

    const isaPosition = {
      x: (supertype.position.x + subX) / 2,
      y: (supertype.position.y + subY) / 2,
    };

    const isaId = createId();
    const isaNode: ISANode = {
      id: isaId,
      type: 'isa',
      position: isaPosition,
      label: 'ES',
      isDisjoint: false,
      isTotal: false,
    };

    const newConnections: Connection[] = [
      {
        id: createId(),
        sourceId: supertype.id,
        targetId: isaId,
        isTotalParticipation: false,
      },
      ...subtypes.map(subtype => ({
        id: createId(),
        sourceId: isaId,
        targetId: subtype.id,
        isTotalParticipation: false,
      })),
    ];

    setNodes([...nodes, isaNode]);
    setConnections([...connections, ...newConnections]);
    setSelectedNodeIds(new Set([isaId]));
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
  };

  return (
    <div className="app-container">
      <Toolbar
        items={(() => {
          const selectionCount = selectedNodeIds.size + selectedConnectionIds.size + selectedAggregationIds.size;
          const items: ToolbarItem[] = [
            {
              id: 'multi-select',
              label: multiSelectMode ? 'Multi-select ON' : 'Multi-select',
              icon: multiSelectMode ? '✓' : '☐',
              action: () => setMultiSelectMode(prev => !prev),
              active: multiSelectMode,
              badge: selectionCount || undefined,
            },
            ...(selectionCount > 0 ? [{
              id: 'clear-selection',
              label: `Clear (${selectionCount})`,
              icon: '✕',
              action: () => {
                setSelectedNodeIds(new Set());
                setSelectedConnectionIds(new Set());
                setSelectedAggregationIds(new Set());
              },
            }] : []),
            // --- Add nodes ---
            { id: 'add-entity', label: 'Entity', icon: '▭', action: () => addNode('entity'), separator: true },
            { id: 'add-relationship', label: 'Relationship', icon: '◇', action: () => addNode('relationship') },
            { id: 'add-attribute', label: 'Attribute', icon: '○', action: () => addNode('attribute') },
            { id: 'add-isa', label: 'ISA', icon: '△', action: () => addNode('isa') },
            // --- Operations ---
            { id: 'connect', label: 'Connect', icon: '↗', action: connectSelected, disabled: !canConnectSelection, separator: true },
            { id: 'delete', label: 'Delete', icon: '🗑', action: deleteSelected, disabled: selectionCount === 0 },
            {
              id: 'aggregate',
              label: 'Aggregate',
              icon: '▣',
              action: () => {
                const memberIds = Array.from(selectedNodeIds);
                if (memberIds.length < 2) { alert('Selecciona al menos dos elementos para agregar.'); return; }
                const hasRelationship = nodes.some(n => memberIds.includes(n.id) && n.type === 'relationship');
                if (!hasRelationship) { alert('La agregación debe incluir al menos una relación.'); return; }
                const newAggregation: Aggregation = { id: createId(), memberIds, padding: 16 };
                setAggregations(prev => [...prev, newAggregation]);
                setSelectedAggregationIds(new Set([newAggregation.id]));
                setSelectedNodeIds(new Set());
                setSelectedConnectionIds(new Set());
              },
              disabled: selectedNodeIds.size < 2,
            },
            {
              id: 'hierarchy',
              label: 'Hierarchy',
              icon: '⊿',
              action: createHierarchy,
              disabled: nodes.filter(n => selectedNodeIds.has(n.id) && n.type === 'entity').length < 2,
            },
            {
              id: 'ungroup',
              label: 'Ungroup',
              icon: '⊟',
              action: () => {
                if (selectedAggregationIds.size === 0) return;
                setAggregations(prev => prev.filter(agg => !selectedAggregationIds.has(agg.id)));
                setSelectedAggregationIds(new Set());
              },
              disabled: selectedAggregationIds.size === 0,
            },
            // --- View & File ---
            { id: 'reset-view', label: 'Reset View', icon: '⟳', action: handleResetView, separator: true },
            { id: 'import', label: 'Import', icon: '📂', action: handleImportClick, separator: true },
            { id: 'export', label: 'Export', icon: '💾', action: handleExport },
            { id: 'restore', label: 'Restore', icon: '⏮', action: handleRestoreSnapshot, disabled: !hasSnapshot },
          ];
          return items;
        })()}
        zoomControls={{
          scale,
          onZoomIn: () => setZoom(scale + 0.1),
          onZoomOut: () => setZoom(scale - 0.1),
          onZoomChange: (v) => setZoom(v),
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={handleImportFile}
        style={{ display: 'none' }}
      />
      <main className="main-content">
        <Canvas
          nodes={nodes.map(n => ({ ...n, selected: selectedNodeIds.has(n.id) }))}
          aggregations={aggregations}
          selectedAggregationIds={selectedAggregationIds}
          connections={connections.map(c => ({ ...c, selected: selectedConnectionIds.has(c.id) }))}
          scale={scale}
          offset={offset}
          onNodesChange={setNodes}
          onConnectionsChange={setConnections}
          onViewChange={(newScale, newOffset) => {
            if (newScale !== undefined) setScale(newScale);
            if (newOffset !== undefined) setOffset(newOffset);
          }}
          onNodeClick={handleNodeClick}
          onAggregationClick={(id, multi) => {
            setSelectedAggregationIds(prev => {
              const newSet = new Set(multi ? prev : []);
              if (newSet.has(id)) {
                newSet.delete(id);
              } else {
                newSet.add(id);
              }
              return newSet;
            });
            if (!multi) {
              setSelectedNodeIds(new Set());
              setSelectedConnectionIds(new Set());
            }
          }}
          onConnectionClick={handleConnectionClick}
          onCanvasClick={handleCanvasClick}
          multiSelectMode={multiSelectMode}
        />
        {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button className={`sidebar-tab ${activeTab === 'properties' ? 'active' : ''}`} onClick={() => setActiveTab('properties')}>Properties</button>
            <button className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Chat</button>
            <button className={`sidebar-tab ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => { setActiveTab('ai'); Promise.all([checkGeminiHealth(), checkGrokHealth(), checkOllamaHealth(), checkOpenclawHealth()]); }}>IA</button>
            <button className={`sidebar-tab ${activeTab === 'menu' ? 'active' : ''}`} onClick={() => setActiveTab('menu')}>Menu</button>
            <button className="sidebar-tab sidebar-close" onClick={() => setSidebarOpen(false)} title="Ocultar panel" aria-label="Ocultar panel">✕</button>
          </div>

          {activeTab === 'properties' && (
          <div className="sidebar-tab-content">
            {selectedNodeIds.size === 1 && (
              <div>
                <p>Selected Node: {Array.from(selectedNodeIds)[0]}</p>
                {(() => {
                  const node = nodes.find(n => n.id === Array.from(selectedNodeIds)[0]);
                  if (!node) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <label>Label: <input value={node.label} onChange={e => updateNode(node.id, { label: e.target.value })} /></label>
                      {node.type === 'entity' && (
                        <label><input type="checkbox" checked={node.isWeak} onChange={e => updateNode(node.id, { isWeak: e.target.checked })} /> Weak Entity</label>
                      )}
                      {node.type === 'relationship' && (
                        <label><input type="checkbox" checked={node.isIdentifying} onChange={e => updateNode(node.id, { isIdentifying: e.target.checked })} /> Identifying</label>
                      )}
                      {node.type === 'attribute' && (
                        <>
                          <label><input type="checkbox" checked={node.isKey} onChange={e => updateNode(node.id, { isKey: e.target.checked })} /> Key</label>
                          <label><input type="checkbox" checked={node.isMultivalued} onChange={e => updateNode(node.id, { isMultivalued: e.target.checked })} /> Multivalued</label>
                          <label><input type="checkbox" checked={node.isDerived} onChange={e => updateNode(node.id, { isDerived: e.target.checked })} /> Derived</label>
                        </>
                      )}
                      {node.type === 'isa' && (
                        <>
                          <label><input type="checkbox" checked={node.isDisjoint} onChange={e => updateNode(node.id, { isDisjoint: e.target.checked })} /> Disjoint</label>
                          <label><input type="checkbox" checked={node.isTotal} onChange={e => updateNode(node.id, { isTotal: e.target.checked })} /> Total</label>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            {selectedConnectionIds.size === 1 && (
              <div>
                <p>Selected Connection: {Array.from(selectedConnectionIds)[0]}</p>
                {(() => {
                  const conn = connections.find(c => c.id === Array.from(selectedConnectionIds)[0]);
                  if (!conn) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <label><input type="checkbox" checked={conn.isTotalParticipation} onChange={e => updateConnection(conn.id, { isTotalParticipation: e.target.checked })} /> Total Participation</label>
                      <label>Cardinality:
                        <select value={conn.cardinality || ''} onChange={e => {
                          const cardValue = safeCardinality(e.target.value);
                          if (cardValue) {
                            updateConnection(conn.id, { cardinality: cardValue });
                          }
                        }}>
                          <option value="">None</option>
                          <option value="1">1</option>
                          <option value="N">N</option>
                          <option value="M">M</option>
                        </select>
                      </label>
                      <label>Role: <input value={conn.role || ''} onChange={e => updateConnection(conn.id, { role: e.target.value })} placeholder="e.g. supervisor" /></label>
                    </div>
                  );
                })()}
              </div>
            )}
            {selectedAggregationIds.size === 1 && (
              <div>
                <p>Selected Aggregation: {Array.from(selectedAggregationIds)[0]}</p>
                {(() => {
                  const agg = aggregations.find(a => a.id === Array.from(selectedAggregationIds)[0]);
                  if (!agg) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p>Members: {agg.memberIds.length}</p>
                    </div>
                  );
                })()}
              </div>
            )}
            {selectedNodeIds.size === 0 && selectedConnectionIds.size === 0 && selectedAggregationIds.size === 0 && (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Selecciona un elemento para ver sus propiedades.</p>
            )}
          </div>
          )}

          {activeTab === 'chat' && (
          <div className="sidebar-tab-content chat-panel">
            {roomId ? (
              <div className="room-bar">
                <span className="room-indicator">● Sala activa</span>
                <button onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                }} className="room-copy-btn">Copiar link</button>
                <button onClick={leaveRoom} className="room-leave-btn">Salir</button>
              </div>
            ) : (
              <div className="room-bar">
                <button onClick={createRoom} className="room-join-btn">Colaborar</button>
              </div>
            )}
            <div className="chat-messages">
              {chatMessages.map(message => (
                <div key={message.id} className={`chat-message ${message.role}`}>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="chat-input">
              <div className="chat-input-wrapper">
                <input
                  ref={chatInputRef}
                  type="text"
                  placeholder="Ej: agregar relacion entre Alumno y Curso"
                  value={chatInput}
                  onChange={e => updateChatSuggestions(e.target.value)}
                  onKeyDown={e => {
                    if (chatSuggestions.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setChatSuggestionIndex(prev => Math.min(prev + 1, chatSuggestions.length - 1));
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setChatSuggestionIndex(prev => Math.max(prev - 1, -1));
                        return;
                      }
                      if (e.key === 'Tab' || (e.key === 'Enter' && chatSuggestionIndex >= 0)) {
                        e.preventDefault();
                        const idx = chatSuggestionIndex >= 0 ? chatSuggestionIndex : 0;
                        applySuggestion(chatSuggestions[idx]);
                        return;
                      }
                      if (e.key === 'Escape') {
                        setChatSuggestions([]);
                        setChatSuggestionIndex(-1);
                        return;
                      }
                    }
                    if (e.key === 'Enter') handleChatSubmit();
                  }}
                  onBlur={() => { setTimeout(() => setChatSuggestions([]), 150); }}
                  autoComplete="off"
                />
                {chatSuggestions.length > 0 && (
                  <ul className="chat-suggestions">
                    {chatSuggestions.map((s, i) => (
                      <li
                        key={s}
                        className={`chat-suggestion-item ${i === chatSuggestionIndex ? 'active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                      >
                        <span className="suggestion-icon">▭</span> {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button onClick={handleChatSubmit} className="primary-button">Enviar</button>
            </div>
          </div>
          )}

          {activeTab === 'ai' && (
          <div className="sidebar-tab-content">
            <div className="sidebar-section">
              <h3>Configuración IA</h3>
              <div className="chat-controls">
                <label>
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    onChange={e => setAiEnabled(e.target.checked)}
                  />
                  Activar IA
                </label>
                <select
                  value={aiProvider}
                  onChange={e => {
                    const provider = e.target.value as AIProvider;
                    setAiProvider(provider);
                    if (provider === 'gemini') {
                      const preferred = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
                      setAiModel(preferred.find(model => geminiModels.includes(model)) ?? geminiModels[0] ?? 'gemini-2.5-pro');
                    } else if (provider === 'grok') {
                      const preferred = ['grok-4-fast', 'grok-3-mini', 'grok-2-latest'];
                      setAiModel(preferred.find(model => grokModels.includes(model)) ?? grokModels[0] ?? 'grok-3-mini');
                    } else if (provider === 'openclaw') {
                      setAiModel(openclawModels[0] || 'openai-codex/gpt-5.4');
                    } else {
                      setAiModel(ollamaModels[0] || 'gemma3');
                    }
                  }}
                  disabled={!aiEnabled}
                >
                  <option value="gemini">Gemini</option>
                  <option value="grok">Grok</option>
                  <option value="ollama">Ollama</option>
                  <option value="openclaw">OpenClaw</option>
                </select>
                {(aiProvider === 'gemini' || aiProvider === 'grok') && (
                  <input
                    type="password"
                    value={aiProvider === 'gemini' ? geminiApiKey : grokApiKey}
                    onChange={e => {
                      if (aiProvider === 'gemini') {
                        setGeminiApiKey(e.target.value);
                      } else {
                        setGrokApiKey(e.target.value);
                      }
                    }}
                    placeholder={aiProvider === 'gemini' ? 'Gemini API Key' : 'Grok API Key (xAI)'}
                    disabled={!aiEnabled}
                  />
                )}
                {aiProvider === 'gemini' && geminiModels.length > 0 ? (
                  <select
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    disabled={!aiEnabled}
                  >
                    {geminiModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : aiProvider === 'grok' && grokModels.length > 0 ? (
                  <select
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    disabled={!aiEnabled}
                  >
                    {grokModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : aiProvider === 'ollama' && ollamaModels.length > 0 ? (
                  <select
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    disabled={!aiEnabled}
                  >
                    {ollamaModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : aiProvider === 'openclaw' && openclawModels.length > 0 ? (
                  <select
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    disabled={!aiEnabled}
                  >
                    {openclawModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    placeholder={
                      aiProvider === 'gemini'
                        ? 'Modelo (ej: gemini-2.5-pro)'
                        : aiProvider === 'grok'
                          ? 'Modelo (ej: grok-3-mini)'
                          : aiProvider === 'openclaw'
                            ? 'Modelo (ej: openai-codex/gpt-5.4)'
                            : 'Modelo (ej: gemma3)'
                    }
                    disabled={!aiEnabled}
                  />
                )}
                <span className="chat-status">
                  {aiStatus === 'thinking' ? `Pensando... ${formatThinkingTime(aiThinkingSeconds)}` : 'Listo'}
                </span>
              </div>
            </div>
            <div className="sidebar-section">
              <h3>Conexiones</h3>
              <div className="ai-connection">
                <div className="status-group">
                  <span className={getStatusClass(aiConnectivity.gemini)}>
                    Gemini: {getStatusLabel('gemini', aiConnectivity.gemini)}
                  </span>
                  {aiConnectivityReason.gemini && (
                    <span className="status-reason">{aiConnectivityReason.gemini}</span>
                  )}
                </div>
                <div className="status-group">
                  <span className={getStatusClass(aiConnectivity.grok)}>
                    Grok: {getStatusLabel('grok', aiConnectivity.grok)}
                  </span>
                  {aiConnectivityReason.grok && (
                    <span className="status-reason">{aiConnectivityReason.grok}</span>
                  )}
                </div>
                <div className="status-group">
                  <span className={getStatusClass(aiConnectivity.ollama)}>
                    Ollama: {getStatusLabel('ollama', aiConnectivity.ollama)}
                  </span>
                  {aiConnectivityReason.ollama && (
                    <span className="status-reason">{aiConnectivityReason.ollama}</span>
                  )}
                </div>
                <div className="status-group">
                  <span className={getStatusClass(aiConnectivity.openclaw)}>
                    OpenClaw: {getStatusLabel('openclaw', aiConnectivity.openclaw)}
                  </span>
                  {aiConnectivityReason.openclaw && (
                    <span className="status-reason">{aiConnectivityReason.openclaw}</span>
                  )}
                </div>
                {lastAIProviderUsed && (
                  <span className="status-note">
                    {lastAIFallbackFrom
                      ? `Fallback: ${getProviderLabel(lastAIFallbackFrom)} → ${getProviderLabel(lastAIProviderUsed)}`
                      : `Usando: ${getProviderLabel(lastAIProviderUsed)}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          )}

          {activeTab === 'menu' && (
          <div className="sidebar-tab-content">
            <div className="sidebar-section">
              <h3>Presets</h3>
              <label>
                Preset:
                <select
                  value={presetSelection}
                  onChange={e => {
                    const value = e.target.value;
                    setPresetSelection(value);
                    if (!value) {
                      setPresetName('');
                      setPresetAttributesInput('');
                      return;
                    }
                    const preset = attributePresets[value];
                    if (preset) {
                      setPresetName(preset.label);
                      setPresetAttributesInput(preset.attributes.join(', '));
                    }
                  }}
                >
                  <option value="">Nuevo...</option>
                  {Object.entries(attributePresets)
                    .sort((a, b) => a[1].label.localeCompare(b[1].label))
                    .map(([key, preset]) => (
                      <option key={key} value={key}>{preset.label}</option>
                    ))}
                </select>
              </label>
              <label>
                Nombre:
                <input
                  type="text"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="Ej: Profesor"
                />
              </label>
              <label>
                Atributos (max 5):
                <input
                  type="text"
                  value={presetAttributesInput}
                  onChange={e => setPresetAttributesInput(e.target.value)}
                  placeholder="id, nombre, email, telefono, especialidad"
                />
              </label>
              <div className="preset-actions">
                <button
                  onClick={() => {
                    const name = presetName.trim();
                    if (!name) return;
                    const attributes = presetAttributesInput
                      .split(',')
                      .flatMap(item => item.split(/\s+y\s+/i))
                      .map(item => item.trim())
                      .filter(Boolean);
                    const normalized = normalizeAttributeList(attributes, 5);
                    const { attributes: finalAttributes } = ensureKeyAttribute(normalized, ['id'], 5);
                    upsertPreset(name, finalAttributes);
                    setPresetSelection(normalizeLabelForPreset(name));
                  }}
                  disabled={!presetName.trim()}
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    if (!presetSelection) return;
                    setAttributePresets(prev => {
                      const next = { ...prev };
                      delete next[presetSelection];
                      return next;
                    });
                    setPresetSelection('');
                    setPresetName('');
                    setPresetAttributesInput('');
                  }}
                  disabled={!presetSelection}
                >
                  Eliminar
                </button>
              </div>
              <div className="preset-transfer">
                <button onClick={exportPresets}>Exportar</button>
                <button onClick={handleImportPresetsClick}>Importar</button>
                <input
                  ref={presetFileInputRef}
                  type="file"
                  accept="application/json"
                  onChange={handleImportPresets}
                  style={{ display: 'none' }}
                />
              </div>
              <div className="preset-hint">
                Se guardan en este navegador.
              </div>
            </div>
          </div>
          )}
        </aside>
        )}
        {!sidebarOpen && (
          <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(true)} title="Mostrar panel" aria-label="Mostrar panel">
            Panel
          </button>
        )}
      </main>
    </div>
  );
}

export default App;
