import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';
import Canvas from './components/Canvas/Canvas';
import type { ERNode, Connection, NodeType, Cardinality, DiagramView, Aggregation, ISANode, EntityNode } from './types/er';
import { createId } from './utils/ids';
import { parseDiagramSnapshot, serializeDiagram } from './utils/diagram';
import { parseChatCommand } from './utils/chatParser';
import { type AICommand, parseAICommandJson, parseAICommandBatch, isLegacyAICommand } from './utils/aiCommands';
import { useLocalStorage } from './hooks/useLocalStorage';
import { safeCardinality } from './utils/schemas';
import Toolbar from './components/Toolbar/Toolbar';
import type { ToolbarItem } from './components/Toolbar/Toolbar';
import { RelationalSchemaView } from './components/Views/RelationalSchemaView';
import { SQLView, registerSQLNavigate } from './components/Views/SQLView';
import AlgebraView from './components/Views/AlgebraView';
import Splitter from './components/Splitter';
import { erToRelationalSchema, buildSQLDDL } from './utils/relationalSchema';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { generateDiagramSVG, svgToPng, downloadDataUrl } from './utils/exportSVG';

type AIProvider = 'gemini' | 'grok' | 'ollama' | 'openclaw' | 'openai';
type AIConnectivityStatus = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'missing-key';

const SNAPSHOT_KEY = 'derup.snapshot.v1';

/**
 * Lee el snapshot guardado en localStorage al iniciar la app, para que el
 * canvas restaure tal cual quedó (nodos+posiciones, conexiones, agregaciones,
 * zoom y pan). Devuelve null si no hay snapshot o está corrupto.
 */
const loadInitialSnapshot = () => {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return parseDiagramSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
};

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

/**
 * Scans the visible canvas area row-by-row (top-left → top-right → next row)
 * and returns the first grid position that has no existing node within CLEAR radius.
 * Falls back to the visible center if every candidate is occupied.
 */
function findFreePosition(
  nodes: ERNode[],
  scale: number,
  offset: { x: number; y: number },
  canvasAreaEl: HTMLDivElement | null
): { x: number; y: number } {
  const wrapperEl = canvasAreaEl?.querySelector('.canvas-wrapper') as HTMLElement | null;
  const rect = wrapperEl?.getBoundingClientRect();
  const canvasW = rect?.width ?? window.innerWidth * 0.6;
  const canvasH = rect?.height ?? window.innerHeight * 0.8;

  const PAD_PX = 60;           // screen-px padding from each edge
  const STEP_PX = 200;         // grid step in screen px
  const CLEAR_PX = 160;        // min distance between nodes in screen px

  const toCanvas = (sx: number, sy: number) => ({
    x: (sx - offset.x) / scale,
    y: (sy - offset.y) / scale,
  });

  const topLeft     = toCanvas(PAD_PX, PAD_PX);
  const bottomRight = toCanvas(canvasW - PAD_PX, canvasH - PAD_PX);
  const step  = STEP_PX  / scale;
  const clear = CLEAR_PX / scale;

  for (let row = 0; topLeft.y + row * step < bottomRight.y; row++) {
    for (let col = 0; topLeft.x + col * step < bottomRight.x; col++) {
      const pos = { x: topLeft.x + col * step, y: topLeft.y + row * step };
      const isFree = nodes.every((n) => {
        const dx = n.position.x - pos.x;
        const dy = n.position.y - pos.y;
        return dx * dx + dy * dy > clear * clear;
      });
      if (isFree) return pos;
    }
  }

  // All candidates occupied → visible center
  return toCanvas(canvasW / 2, canvasH / 2);
}

function App() {
  // Restaurar el diagrama exactamente como quedó la última vez (posiciones,
  // conexiones, agregaciones, zoom, pan). Si no hay snapshot, usar el demo.
  const initialSnapshot = useMemo(() => loadInitialSnapshot(), []);

  const [nodes, setNodes] = useState<ERNode[]>(() => initialSnapshot?.nodes ?? [
    { id: '1', type: 'entity', position: { x: 100, y: 100 }, label: 'Student', isWeak: false },
    { id: '2', type: 'entity', position: { x: 400, y: 100 }, label: 'Course', isWeak: false },
    { id: '3', type: 'relationship', position: { x: 250, y: 100 }, label: 'Enrolled', isIdentifying: false },
    { id: '4', type: 'attribute', position: { x: 100, y: 200 }, label: 'Name', isKey: false, isMultivalued: false, isDerived: false }
  ]);

  const [connections, setConnections] = useState<Connection[]>(() => initialSnapshot?.connections ?? [
    { id: 'c1', sourceId: '1', targetId: '3', isTotalParticipation: false, cardinality: 'M' },
    { id: 'c2', sourceId: '3', targetId: '2', isTotalParticipation: false, cardinality: 'N' },
    { id: 'c3', sourceId: '1', targetId: '4', isTotalParticipation: false }
  ]);

  const [scale, setScale] = useState(() => initialSnapshot?.view?.scale ?? 1);
  const [offset, setOffset] = useState(() => initialSnapshot?.view?.offset ?? { x: 0, y: 0 });
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
  const [selectedAggregationIds, setSelectedAggregationIds] = useState<Set<string>>(new Set());
  const [aggregations, setAggregations] = useState<Aggregation[]>(() => initialSnapshot?.aggregations ?? []);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState(true);
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState<string | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [chatSuggestionIndex, setChatSuggestionIndex] = useState(-1);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState<AIProvider>('openai');
  const [aiModel, setAiModel] = useState('gpt-5.4');
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [grokModels, setGrokModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openclawModels, setOpenclawModels] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<'idle' | 'thinking'>('idle');
  const [aiThinkingSeconds, setAiThinkingSeconds] = useState(0);
  const [geminiApiKey, setGeminiApiKey] = useLocalStorage('gemini_api_key', '');
  const [grokApiKey, setGrokApiKey] = useLocalStorage('grok_api_key', '');
  // OpenAI uses server-side OAuth — no client API key needed
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [aiConnectivity, setAiConnectivity] = useState<{
    gemini: AIConnectivityStatus;
    grok: AIConnectivityStatus;
    ollama: AIConnectivityStatus;
    openclaw: AIConnectivityStatus;
    openai: AIConnectivityStatus;
  }>({
    gemini: 'unknown',
    grok: 'unknown',
    ollama: 'unknown',
    openclaw: 'unknown',
    openai: 'unknown',
  });
  const [aiConnectivityReason, setAiConnectivityReason] = useState<{ gemini: string; grok: string; ollama: string; openclaw: string; openai: string }>({
    gemini: '',
    grok: '',
    ollama: '',
    openclaw: '',
    openai: '',
  });
  const [lastAIProviderUsed, setLastAIProviderUsed] = useState<AIProvider | null>(null);
  const [lastAIFallbackFrom, setLastAIFallbackFrom] = useState<AIProvider | null>(null);
  const [attributePresets, setAttributePresets] = useLocalStorage('derup.presets.v1', DEFAULT_ATTRIBUTE_PRESETS);
  const [presetSelection, setPresetSelection] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetAttributesInput, setPresetAttributesInput] = useState('');
  const [modelingHints, setModelingHints] = useState<string[]>([]);
  const [fewShotExamples, setFewShotExamples] = useState<Array<{ input: string; output: string }>>([]);
  const [domainMemory, setDomainMemory] = useState<Record<string, string[]>>({});
  const lastAIInteraction = useRef<{ userInput: string; aiOutput: string; commandType: string } | null>(null);
  const learningLoaded = useRef(false);
  const [canvasView, setCanvasView] = useState<'er' | 'schema' | 'sql' | 'algebra'>('er');
  /** Pending algebra-query command from the chat (algebra mode). The
   *  AlgebraView consumes this when present, inserts the query into the
   *  editor and runs it. Bumped each time so the same query can be applied
   *  again. */
  const [pendingAlgebraQuery, setPendingAlgebraQuery] = useState<{ query: string; run: boolean; at: number } | null>(null);
  /** Pending data mutation from the chat (algebra-data command). Once the
   *  user confirms, this is forwarded to AlgebraView to apply. */
  const [pendingAlgebraData, setPendingAlgebraData] = useState<{
    action: 'append' | 'replace' | 'update-row' | 'delete-rows' | 'create-relation';
    relation: string;
    columns?: { name: string; type: 'number' | 'string' | 'date' | 'boolean' }[];
    rows?: (string | number | boolean | null)[][];
    rowIndex?: number;
    values?: Record<string, string | number | boolean | null>;
    rowIndices?: number[];
    at: number;
  } | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** Sidebar width in px, persisted across sessions. Drag the splitter on the
   *  sidebar's left edge to resize. Clamped to a sane range. */
  const [sidebarWidth, setSidebarWidth] = useLocalStorage<number>('derup.sidebar.width', 320);
  const sidebarDragBaseline = useRef(sidebarWidth);
  const [activeTab, setActiveTab] = useState<'properties' | 'chat' | 'ai' | 'menu'>('chat');
  const [lastScenarioText, setLastScenarioText] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const batchQueueRef = useRef<AICommand[]>([]);
  const batchContinueRef = useRef(false);
  const [batchTick, setBatchTick] = useState(0);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  const [roomId, setRoomId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isSyncingRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetFileInputRef = useRef<HTMLInputElement>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const currentView: DiagramView = { scale, offset };

  const relationalSchema = useMemo(
    () => erToRelationalSchema(nodes, connections, aggregations),
    [nodes, connections, aggregations]
  );
  const sqlDDL = useMemo(() => buildSQLDDL(relationalSchema), [relationalSchema]);

  const handleExportImage = async (format: 'png' | 'pdf') => {
    if (isExporting) return;
    setIsExporting(true);
    const filename = `derup-${canvasView}-${Date.now()}`;
    try {
      if (canvasView === 'er') {
        // ── ER view: generate pure SVG from model data (no DOM capture) ──────
        const svgString = generateDiagramSVG(nodes, connections, aggregations);
        const imgData   = await svgToPng(svgString, 2);
        if (format === 'png') {
          downloadDataUrl(imgData, `${filename}.png`);
        } else {
          const tmp = document.createElement('canvas');
          const img = new Image();
          await new Promise<void>((res, rej) => {
            img.onload = () => res(); img.onerror = rej; img.src = imgData;
          });
          tmp.width = img.naturalWidth; tmp.height = img.naturalHeight;
          tmp.getContext('2d')!.drawImage(img, 0, 0);
          const w = tmp.width / 2, h = tmp.height / 2;
          const pdf = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
          pdf.addImage(imgData, 'PNG', 0, 0, w, h);
          pdf.save(`${filename}.pdf`);
        }
      } else {
        // ── Schema / SQL views: capture the content div (no transforms) ──────
        const el = canvasAreaRef.current;
        const contentEl = el?.querySelector('.rs-root, .sql-root') as HTMLElement | null;
        const target = contentEl ?? el;
        if (!target) return;
        const canvas = await html2canvas(target, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          scrollX: 0,
          scrollY: 0,
        });
        const imgData = canvas.toDataURL('image/png');
        if (format === 'png') {
          downloadDataUrl(imgData, `${filename}.png`);
        } else {
          const w = canvas.width / 2, h = canvas.height / 2;
          const pdf = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
          pdf.addImage(imgData, 'PNG', 0, 0, w, h);
          pdf.save(`${filename}.pdf`);
        }
      }
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setIsExporting(false);
    }
  };

  // ── Schema / SQL view navigation + rename ────────────────────────────────
  const handleNavigateToNode = (sourceId: string) => {
    setSelectedNodeIds(new Set([sourceId]));
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
    setLastSelectedNodeId(sourceId);
    setCanvasView('er');
    setActiveTab('properties');
    // Center canvas on the target node
    const node = nodes.find(n => n.id === sourceId);
    if (node && canvasAreaRef.current) {
      const rect = canvasAreaRef.current.getBoundingClientRect();
      const TAB_H = 48;
      const vw = rect.width;
      const vh = rect.height - TAB_H;
      setOffset({
        x: vw / 2 - node.position.x * scale,
        y: vh / 2 - node.position.y * scale,
      });
    }
  };

  const handleSelectNode = (sourceId: string, multi: boolean) => {
    setSelectedNodeIds(prev => {
      const next = new Set(multi ? prev : []);
      if (multi && prev.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
    setSelectedConnectionIds(new Set());
    setSelectedAggregationIds(new Set());
    setLastSelectedNodeId(sourceId);
  };

  const handleRenameNode = (sourceId: string, newLabel: string) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === sourceId ? { ...n, label: newLabel } : n))
    );
  };

  // Register global navigate handler for SQL inline onclick
  useEffect(() => {
    registerSQLNavigate(handleNavigateToNode);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const canConnectSelection = useMemo(() => {
    const connectableIds = Array.from(new Set([...selectedNodeIds, ...selectedAggregationIds]));
    if (connectableIds.length < 2) return false;

    // Case: exactly 2 items (original behavior + aggregation support)
    if (connectableIds.length === 2) {
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
    }

    // Case: 3+ items — must be exactly 1 relationship/ISA + N entities/aggregations
    const selectedNodes = connectableIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);
    const aggIds = connectableIds.filter(id => selectedAggregationIds.has(id));
    const hubs = selectedNodes.filter(n => n!.type === 'relationship' || n!.type === 'isa');
    const entities = selectedNodes.filter(n => n!.type === 'entity');
    const connectables = entities.length + aggIds.length;
    return hubs.length === 1 && connectables >= 1
      && hubs.length + entities.length + aggIds.length === connectableIds.length;
  }, [nodes, selectedAggregationIds, selectedNodeIds]);

  useEffect(() => {
    try {
      setHasSnapshot(!!localStorage.getItem(SNAPSHOT_KEY));
    } catch {
      setHasSnapshot(false);
    }
  }, []);

  // Load shared learning data from server on mount
  useEffect(() => {
    if (learningLoaded.current) return;
    learningLoaded.current = true;
    fetch('/api/learning').then(r => r.json()).then(data => {
      if (Array.isArray(data.hints)) setModelingHints(data.hints);
      if (Array.isArray(data.examples)) setFewShotExamples(data.examples);
      if (data.domain && typeof data.domain === 'object') setDomainMemory(data.domain);
    }).catch(() => { /* server not available, use empty */ });
  }, []);

  const reportHintToServer = (text: string) => {
    fetch('/api/learning/hint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(r => r.json()).then(data => {
      if (data.promoted) {
        // Reload promoted hints
        fetch('/api/learning').then(r => r.json()).then(d => {
          if (Array.isArray(d.hints)) setModelingHints(d.hints);
        }).catch(() => {});
      }
    }).catch(() => {});
  };

  const reportExampleToServer = (input: string, output: string) => {
    fetch('/api/learning/example', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, output }),
    }).catch(() => {});
  };

  const reportDomainToServer = (domain: string, entities: string[]) => {
    fetch('/api/learning/domain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, entities }),
    }).catch(() => {});
  };

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
    if (batchQueueRef.current.length === 0) return;
    const cmd = batchQueueRef.current[0];
    batchQueueRef.current = batchQueueRef.current.slice(1);

    const remaining = batchQueueRef.current.length;
    const total = batchProgress?.total ?? 0;
    setBatchProgress({ current: total - remaining, total });

    if (cmd.type === 'chat') {
      // Check for auto-continuation signal
      if (cmd.message === 'CONTINUE') {
        // Don't show CONTINUE to user — trigger next round automatically
        batchContinueRef.current = true;
      } else {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: cmd.message }]);
      }
    } else {
      const { nodes: nextNodes, connections: nextConns, ok, message } = applyCommandToState(cmd, nodesRef.current, connectionsRef.current);
      setNodes(nextNodes);
      setConnections(nextConns);
      if (!ok) {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `⚠ ${message}` }]);
      }
    }

    if (batchQueueRef.current.length > 0) {
      setTimeout(() => setBatchTick(t => t + 1), 120);
    } else {
      setBatchProgress(null);
      if (batchContinueRef.current) {
        batchContinueRef.current = false;
        // Auto-continue: ask AI to generate remaining commands
        triggerAIContinuation();
      } else {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: 'Correcciones aplicadas.' }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchTick]);

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
  }, [nodes, aggregations, connections, scale, offset]);

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

  const fitNodesToScreen = (nodesToFit: ERNode[]) => {
    if (nodesToFit.length === 0) return;
    const padding = 80;
    const sidebarWidth = sidebarOpen ? 320 : 0;
    const toolbarHeight = 40;
    const canvasWidth = window.innerWidth - sidebarWidth;
    const canvasHeight = window.innerHeight - toolbarHeight;
    const NODE_HALF: Record<string, { w: number; h: number }> = {
      entity: { w: 70, h: 35 },
      relationship: { w: 60, h: 30 },
      attribute: { w: 50, h: 20 },
      isa: { w: 20, h: 20 },
    };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodesToFit.forEach(node => {
      const half = NODE_HALF[node.type] ?? { w: 50, h: 25 };
      minX = Math.min(minX, node.position.x - half.w);
      minY = Math.min(minY, node.position.y - half.h);
      maxX = Math.max(maxX, node.position.x + half.w);
      maxY = Math.max(maxY, node.position.y + half.h);
    });
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;
    const newScale = clampScale(Math.min(
      (canvasWidth - padding * 2) / contentW,
      (canvasHeight - padding * 2) / contentH,
      1.2
    ));
    const newOffset = {
      x: canvasWidth / 2 - ((minX + maxX) / 2) * newScale,
      y: canvasHeight / 2 - ((minY + maxY) / 2) * newScale,
    };
    setScale(newScale);
    setOffset(newOffset);
  };

  const applyCommandToState = (
    cmd: AICommand,
    curNodes: ERNode[],
    curConns: Connection[],
  ): { nodes: ERNode[]; connections: Connection[]; ok: boolean; message: string } => {
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const findNode = (label: string, type: NodeType) =>
      curNodes.find(n => n.type === type && norm(n.label) === norm(label)) ?? null;
    const findAny = (label: string) =>
      findNode(label, 'entity') ?? findNode(label, 'relationship');
    const fail = (msg: string) => ({ nodes: curNodes, connections: curConns, ok: false, message: msg });

    if (cmd.type === 'set-entity-weakness') {
      const e = findNode(cmd.entityName, 'entity');
      if (!e) return fail(`Entidad "${cmd.entityName}" no encontrada.`);
      return { nodes: curNodes.map(n => n.id === e.id && n.type === 'entity' ? { ...n, isWeak: cmd.isWeak } : n), connections: curConns, ok: true, message: `${e.label}: ${cmd.isWeak ? 'débil' : 'fuerte'}.` };
    }

    if (cmd.type === 'set-cardinality') {
      const eA = findNode(cmd.entityA, 'entity');
      const eB = findNode(cmd.entityB, 'entity');
      if (!eA || !eB) return fail(`Entidades "${cmd.entityA}" / "${cmd.entityB}" no encontradas.`);
      const rel = curNodes.find(n => {
        if (n.type !== 'relationship') return false;
        const hA = curConns.some(c => (c.sourceId === n.id && c.targetId === eA.id) || (c.sourceId === eA.id && c.targetId === n.id));
        const hB = curConns.some(c => (c.sourceId === n.id && c.targetId === eB.id) || (c.sourceId === eB.id && c.targetId === n.id));
        return hA && hB;
      });
      if (!rel) return fail(`No hay relación entre "${cmd.entityA}" y "${cmd.entityB}".`);
      return {
        nodes: curNodes,
        connections: curConns.map(c => {
          const isA = (c.sourceId === rel.id && c.targetId === eA.id) || (c.sourceId === eA.id && c.targetId === rel.id);
          const isB = (c.sourceId === rel.id && c.targetId === eB.id) || (c.sourceId === eB.id && c.targetId === rel.id);
          if (isA && cmd.cardinalityA) return { ...c, cardinality: cmd.cardinalityA as Connection['cardinality'] };
          if (isB && cmd.cardinalityB) return { ...c, cardinality: cmd.cardinalityB as Connection['cardinality'] };
          return c;
        }),
        ok: true,
        message: `${rel.label}: ${cmd.cardinalityA ?? '?'}:${cmd.cardinalityB ?? '?'}.`,
      };
    }

    if (cmd.type === 'set-participation') {
      const e = findNode(cmd.entityName, 'entity');
      const r = findNode(cmd.relationshipName, 'relationship');
      if (!e || !r) return fail(`No encontré "${cmd.entityName}" o "${cmd.relationshipName}".`);
      return {
        nodes: curNodes,
        connections: curConns.map(c => {
          const match = (c.sourceId === r.id && c.targetId === e.id) || (c.sourceId === e.id && c.targetId === r.id);
          return match ? { ...c, isTotalParticipation: cmd.isTotal } : c;
        }),
        ok: true,
        message: `Participación ${e.label} en ${r.label}: ${cmd.isTotal ? 'total' : 'parcial'}.`,
      };
    }

    if (cmd.type === 'set-attribute-type') {
      const parent = findAny(cmd.entityName);
      if (!parent) return fail(`"${cmd.entityName}" no encontrado.`);
      const attrIds = new Set(curConns.filter(c => c.sourceId === parent.id || c.targetId === parent.id).map(c => c.sourceId === parent.id ? c.targetId : c.sourceId));
      const attr = curNodes.find(n => n.type === 'attribute' && attrIds.has(n.id) && norm(n.label) === norm(cmd.attributeName));
      if (!attr || attr.type !== 'attribute') return fail(`Atributo "${cmd.attributeName}" no encontrado en ${parent.label}.`);
      const updated: typeof attr = {
        ...attr,
        isKey: cmd.isKey ?? attr.isKey,
        isMultivalued: cmd.isMultivalued ?? attr.isMultivalued,
        isDerived: cmd.isDerived ?? attr.isDerived,
      };
      return { nodes: curNodes.map(n => n.id === attr.id ? updated : n), connections: curConns, ok: true, message: `Atributo ${attr.label} de ${parent.label} actualizado.` };
    }

    if (cmd.type === 'add-attributes') {
      const parent = findAny(cmd.entityName);
      if (!parent) return fail(`"${cmd.entityName}" no encontrado.`);
      const existingIds = new Set(curConns.filter(c => c.sourceId === parent.id || c.targetId === parent.id).map(c => c.sourceId === parent.id ? c.targetId : c.sourceId));
      const existingLabels = new Set(curNodes.filter(n => n.type === 'attribute' && existingIds.has(n.id)).map(n => norm(n.label)));
      const newAttrs = cmd.attributes.filter(a => !existingLabels.has(norm(a)));
      if (newAttrs.length === 0) return { nodes: curNodes, connections: curConns, ok: true, message: `${parent.label} ya tiene esos atributos.` };
      const keySet = new Set((cmd.keyAttributes ?? []).map(k => norm(k)));
      const occupied = curNodes.map(n => ({ type: n.type, position: n.position }));
      const positions = placeAttributePositions(newAttrs, parent.position, occupied);
      const newAttrNodes: import('./types/er').AttributeNode[] = newAttrs.map((attr, i) => ({
        id: createId(), type: 'attribute' as const,
        position: positions[i] ?? { x: parent.position.x + 100 + i * 20, y: parent.position.y + 60 + i * 15 },
        label: attr, isKey: keySet.has(norm(attr)), isMultivalued: false, isDerived: false,
      }));
      const newConns: Connection[] = newAttrNodes.map(n => ({ id: createId(), sourceId: parent.id, targetId: n.id, isTotalParticipation: false }));
      return { nodes: [...curNodes, ...newAttrNodes], connections: [...curConns, ...newConns], ok: true, message: `Atributos agregados a ${parent.label}: ${newAttrs.join(', ')}.` };
    }

    if (cmd.type === 'rename-entity') {
      const e = findNode(cmd.entityName, 'entity');
      if (!e) return fail(`Entidad "${cmd.entityName}" no encontrada.`);
      return { nodes: curNodes.map(n => n.id === e.id ? { ...n, label: cmd.newName } : n), connections: curConns, ok: true, message: `${e.label} → ${cmd.newName}.` };
    }

    if (cmd.type === 'rename-relationship') {
      const r = findNode(cmd.relationshipName, 'relationship');
      if (!r) return fail(`Relación "${cmd.relationshipName}" no encontrada.`);
      return { nodes: curNodes.map(n => n.id === r.id ? { ...n, label: cmd.newName } : n), connections: curConns, ok: true, message: `${r.label} → ${cmd.newName}.` };
    }

    if (cmd.type === 'replace-attributes') {
      const parent = findAny(cmd.entityName);
      if (!parent) return fail(`"${cmd.entityName}" no encontrado.`);
      // Remove all existing attribute nodes connected to this parent
      const existingAttrIds = new Set(
        curConns
          .filter(c => c.sourceId === parent.id || c.targetId === parent.id)
          .map(c => c.sourceId === parent.id ? c.targetId : c.sourceId)
          .filter(id => curNodes.find(n => n.id === id && n.type === 'attribute'))
      );
      const prunedNodes = curNodes.filter(n => !existingAttrIds.has(n.id));
      const prunedConns = curConns.filter(c => !existingAttrIds.has(c.sourceId) && !existingAttrIds.has(c.targetId));
      const keySet = new Set((cmd.keyAttributes ?? []).map(k => norm(k)));
      const occupied = prunedNodes.map(n => ({ type: n.type, position: n.position }));
      const positions = placeAttributePositions(cmd.attributes, parent.position, occupied);
      const newAttrNodes: import('./types/er').AttributeNode[] = cmd.attributes.map((attr, i) => ({
        id: createId(), type: 'attribute' as const,
        position: positions[i] ?? { x: parent.position.x + 100 + i * 20, y: parent.position.y + 60 + i * 15 },
        label: attr, isKey: keySet.has(norm(attr)), isMultivalued: false, isDerived: false,
      }));
      const newConns: Connection[] = newAttrNodes.map(n => ({ id: createId(), sourceId: parent.id, targetId: n.id, isTotalParticipation: false }));
      return { nodes: [...prunedNodes, ...newAttrNodes], connections: [...prunedConns, ...newConns], ok: true, message: `Atributos de ${parent.label} reemplazados: ${cmd.attributes.join(', ')}.` };
    }

    if (cmd.type === 'add-entity') {
      const label = normalizeEntityLabel(cmd.entityName);
      if (curNodes.some(n => n.type === 'entity' && norm(n.label) === norm(label))) {
        return { nodes: curNodes, connections: curConns, ok: true, message: `${label} ya existe.` };
      }
      let attrs = cmd.attributes?.length > 0 ? cmd.attributes : getDefaultAttributesForEntity(label);
      const keySet = new Set((cmd.keyAttributes ?? []).map(k => norm(k)));
      const normalizedAttrs = normalizeAttributeList(attrs, 5);
      const { attributes: finalAttrs, keys: keyList } = ensureKeyAttribute(normalizedAttrs, cmd.keyAttributes ?? [], 5);
      const center = getCanvasCenter();
      const entityId = createId();
      // Space entities in a grid layout based on existing entity count
      const existingEntityCount = curNodes.filter(n => n.type === 'entity').length;
      const col = existingEntityCount % 3;
      const row = Math.floor(existingEntityCount / 3);
      const spacing = 300;
      const baseX = (center.x - offset.x) / scale - spacing;
      const baseY = (center.y - offset.y) / scale - spacing / 2;
      const entityPos = {
        x: baseX + col * spacing,
        y: baseY + row * spacing,
      };
      const entityNode: ERNode = { id: entityId, type: 'entity', position: entityPos, label, isWeak: false };
      const occupied = curNodes.map(n => ({ type: n.type, position: n.position }));
      const positions = placeAttributePositions(finalAttrs, entityPos, occupied);
      const attrNodes: import('./types/er').AttributeNode[] = finalAttrs.map((a, i) => ({
        id: createId(), type: 'attribute' as const,
        position: positions[i] ?? { x: entityPos.x + 80 + i * 20, y: entityPos.y + 50 + i * 15 },
        label: a, isKey: keySet.has(norm(a)) || keyList.includes(a), isMultivalued: false, isDerived: false,
      }));
      const attrConns: Connection[] = attrNodes.map(n => ({ id: createId(), sourceId: entityId, targetId: n.id, isTotalParticipation: false }));
      if (!getPresetAttributesForEntity(label)) upsertPreset(label, finalAttrs);
      return { nodes: [...curNodes, entityNode, ...attrNodes], connections: [...curConns, ...attrConns], ok: true, message: `Entidad ${label} creada con ${finalAttrs.join(', ')}.` };
    }

    if (cmd.type === 'connect-entities') {
      const eA = findNode(cmd.entityA, 'entity');
      const eB = findNode(cmd.entityB, 'entity');
      const eC = cmd.entityC ? findNode(cmd.entityC, 'entity') : null;
      if (!eA || !eB) return fail(`Entidades "${cmd.entityA}" / "${cmd.entityB}" no encontradas.`);
      if (cmd.entityC && !eC) return fail(`Entidad "${cmd.entityC}" no encontrada.`);

      const allEntities = eC ? [eA, eB, eC] : [eA, eB];
      const midX = allEntities.reduce((s, e) => s + e.position.x, 0) / allEntities.length;
      const midY = allEntities.reduce((s, e) => s + e.position.y, 0) / allEntities.length;
      const relLabel = cmd.relationshipName ? normalizeEntityLabel(cmd.relationshipName) : 'Relación';
      const relId = createId();
      const relNode: ERNode = { id: relId, type: 'relationship', position: { x: midX, y: midY }, label: relLabel, isIdentifying: false };

      const newConns: Connection[] = [
        { id: createId(), sourceId: eA.id, targetId: relId, cardinality: cmd.cardinalityA as Connection['cardinality'], isTotalParticipation: cmd.totalA ?? false, role: cmd.roleA },
        { id: createId(), sourceId: relId, targetId: eB.id, cardinality: cmd.cardinalityB as Connection['cardinality'], isTotalParticipation: cmd.totalB ?? false, role: cmd.roleB },
      ];
      if (eC) {
        newConns.push({ id: createId(), sourceId: eC.id, targetId: relId, cardinality: cmd.cardinalityC as Connection['cardinality'], isTotalParticipation: cmd.totalC ?? false, role: cmd.roleC });
      }

      const names = allEntities.map(e => e.label).join(', ');
      return { nodes: [...curNodes, relNode], connections: [...curConns, ...newConns], ok: true, message: `Relación${eC ? ' ternaria' : ''} ${relLabel} entre ${names}.` };
    }

    if (cmd.type === 'delete-entity') {
      const e = findNode(cmd.entityName, 'entity');
      if (!e) return fail(`Entidad "${cmd.entityName}" no encontrada.`);
      const connectedIds = new Set(curConns.filter(c => c.sourceId === e.id || c.targetId === e.id).map(c => c.sourceId === e.id ? c.targetId : c.sourceId));
      const attrIds = new Set([...connectedIds].filter(id => curNodes.find(n => n.id === id)?.type === 'attribute'));
      return { nodes: curNodes.filter(n => n.id !== e.id && !attrIds.has(n.id)), connections: curConns.filter(c => c.sourceId !== e.id && c.targetId !== e.id && !attrIds.has(c.sourceId) && !attrIds.has(c.targetId)), ok: true, message: `${e.label} eliminada.` };
    }

    if (cmd.type === 'delete-relationship') {
      const r = findNode(cmd.relationshipName, 'relationship');
      if (!r) return fail(`Relación "${cmd.relationshipName}" no encontrada.`);
      return { nodes: curNodes.filter(n => n.id !== r.id), connections: curConns.filter(c => c.sourceId !== r.id && c.targetId !== r.id), ok: true, message: `${r.label} eliminada.` };
    }

    if (cmd.type === 'set-connection-role') {
      const entity = findNode(cmd.entityName, 'entity');
      const rel = findNode(cmd.relationshipName, 'relationship');
      if (!entity || !rel) return fail(`No encontré "${cmd.entityName}" o "${cmd.relationshipName}".`);
      const conn = curConns.find(c => (c.sourceId === entity.id && c.targetId === rel.id) || (c.sourceId === rel.id && c.targetId === entity.id));
      if (!conn) return fail(`No hay conexión entre "${cmd.entityName}" y "${cmd.relationshipName}".`);
      return { nodes: curNodes, connections: curConns.map(c => c.id === conn.id ? { ...c, role: cmd.role } : c), ok: true, message: `Rol de ${entity.label} en ${rel.label}: ${cmd.role}.` };
    }

    if (cmd.type === 'chat') {
      return { nodes: curNodes, connections: curConns, ok: true, message: cmd.message };
    }

    // Unsupported in batch — process individually via main flow
    return fail(`Comando "${cmd.type}" no soportado en modo batch — ejecutalo individualmente.`);
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
        position = findFreePosition(nodes, scale, offset, canvasAreaRef.current);
      }
    } else {
      position = findFreePosition(nodes, scale, offset, canvasAreaRef.current);
    }

    const label = `New ${type}`;

    let newNode: ERNode;

    if (type === 'entity') {
      newNode = { id, type: 'entity', position, label, isWeak: false };
    } else if (type === 'relationship') {
      newNode = { id, type: 'relationship', position, label, isIdentifying: false };
    } else if (type === 'attribute') {
      newNode = { id, type: 'attribute', position, label, isKey: false, isMultivalued: false, isDerived: false };
    } else if (type === 'textbox') {
      newNode = { id, type: 'textbox', position, label: 'Texto', text: '' };
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
        setActiveTab('properties');
      }
      return newSet;
    });
    setLastSelectedNodeId(id);
    if (!multi) {
      setSelectedConnectionIds(new Set());
      setSelectedAggregationIds(new Set());
    }
  };

  const handleBoxSelect = (nodeIds: string[], aggIds: string[]) => {
    setSelectedNodeIds(new Set(nodeIds));
    setSelectedAggregationIds(new Set(aggIds));
    setSelectedConnectionIds(new Set());
    if (nodeIds.length > 0) setActiveTab('properties');
  };

  const handleConnectionClick = (id: string, multi: boolean) => {
    setSelectedConnectionIds(prev => {
      const newSet = new Set(multi ? prev : []);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
        setActiveTab('properties');
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

  const explainRelationship = (relationshipNodeId: string) => {
    const relNode = nodes.find(n => n.id === relationshipNodeId && n.type === 'relationship');
    if (!relNode) return;

    const relConns = connections.filter(c => c.sourceId === relationshipNodeId || c.targetId === relationshipNodeId);

    const entityConns: Array<{ entity: ERNode; conn: Connection }> = [];
    const attrConns: Array<{ attr: ERNode; conn: Connection }> = [];

    for (const conn of relConns) {
      const otherId = conn.sourceId === relationshipNodeId ? conn.targetId : conn.sourceId;
      const otherNode = nodes.find(n => n.id === otherId);
      if (!otherNode) continue;
      if (otherNode.type === 'entity') {
        entityConns.push({ entity: otherNode, conn });
      } else if (otherNode.type === 'attribute') {
        attrConns.push({ attr: otherNode, conn });
      }
    }

    const lines: string[] = [];
    lines.push(`### Relación: **${relNode.label}**`);

    if ('isIdentifying' in relNode && relNode.isIdentifying) {
      lines.push('> Relación **identificadora** (doble diamante).');
    }

    if (entityConns.length === 0) {
      lines.push('No tiene entidades conectadas.');
    } else {
      const entityIds = entityConns.map(ec => ec.entity.id);
      const isSelfRelationship = entityIds.length === 2 && entityIds[0] === entityIds[1];

      lines.push('');
      lines.push('**Entidades participantes:**');

      if (isSelfRelationship) {
        const ent = entityConns[0].entity;
        lines.push(`- **${ent.label}** (autorrelación — la misma entidad participa dos veces)`);
        for (const { conn } of entityConns) {
          const card = conn.cardinality || '—';
          const participation = conn.isTotalParticipation ? 'total' : 'parcial';
          const role = conn.role ? ` (rol: ${conn.role})` : '';
          lines.push(`  - Cardinalidad: **${card}**, participación: **${participation}**${role}`);
        }
      } else {
        for (const { entity, conn } of entityConns) {
          const card = conn.cardinality || '—';
          const participation = conn.isTotalParticipation ? 'total' : 'parcial';
          const role = conn.role ? ` (rol: ${conn.role})` : '';
          const weak = (entity.type === 'entity' && entity.isWeak) ? ' *(débil)*' : '';
          lines.push(`- **${entity.label}**${weak}: cardinalidad **${card}**, participación **${participation}**${role}`);
        }
      }

      lines.push('');
      lines.push('**Interpretación:**');

      if (isSelfRelationship) {
        const ent = entityConns[0].entity;
        lines.push(`Una instancia de **${ent.label}** se relaciona con otra instancia de **${ent.label}** a través de "${relNode.label}".`);
      } else if (entityConns.length === 2) {
        const a = entityConns[0];
        const b = entityConns[1];
        const cardA = a.conn.cardinality || '1';
        const cardB = b.conn.cardinality || '1';
        const readableCard = (c: string) => c === '1' ? 'una' : 'muchas';

        lines.push(`Cada **${a.entity.label}** se asocia con **${readableCard(cardB)}** instancia(s) de **${b.entity.label}**, y cada **${b.entity.label}** se asocia con **${readableCard(cardA)}** instancia(s) de **${a.entity.label}**.`);

        const restrictions: string[] = [];
        if (a.conn.isTotalParticipation) restrictions.push(`toda instancia de **${a.entity.label}** debe participar en "${relNode.label}"`);
        if (b.conn.isTotalParticipation) restrictions.push(`toda instancia de **${b.entity.label}** debe participar en "${relNode.label}"`);
        if (restrictions.length > 0) {
          lines.push('');
          lines.push('**Restricciones:**');
          restrictions.forEach(r => lines.push(`- ${r}`));
        }
      } else {
        const names = entityConns.map(ec => `**${ec.entity.label}**`).join(', ');
        lines.push(`Relación ${entityConns.length}-aria entre ${names}.`);
      }
    }

    if (attrConns.length > 0) {
      lines.push('');
      lines.push('**Atributos de la relación:**');
      for (const { attr } of attrConns) {
        const flags: string[] = [];
        if (attr.type === 'attribute') {
          if (attr.isKey) flags.push('clave');
          if (attr.isMultivalued) flags.push('multivaluado');
          if (attr.isDerived) flags.push('derivado');
        }
        const flagStr = flags.length > 0 ? ` _(${flags.join(', ')})_` : '';
        lines.push(`- ${attr.label}${flagStr}`);
      }
    }

    const message = lines.join('\n');
    setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: message }]);
    setActiveTab('chat');
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
    if (connectableIds.length < 2) return;

    // Multi-connect: N entities/aggregations + 1 relationship/ISA → connect each to it
    if (connectableIds.length > 2) {
      const selectedNodes = connectableIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);
      const hub = selectedNodes.find(n => n!.type === 'relationship' || n!.type === 'isa');
      const entities = selectedNodes.filter(n => n!.type === 'entity');
      const aggIds = connectableIds.filter(id => selectedAggregationIds.has(id));
      if (!hub || (entities.length === 0 && aggIds.length === 0)) return;

      const newConns: Connection[] = [];
      // Connect entities to hub
      for (const entity of entities) {
        const alreadyConnected = connections.some(c =>
          (c.sourceId === entity!.id && c.targetId === hub.id) ||
          (c.sourceId === hub.id && c.targetId === entity!.id)
        );
        if (!alreadyConnected) {
          newConns.push({
            id: createId(),
            sourceId: entity!.id,
            targetId: hub.id,
            isTotalParticipation: false,
          });
        }
      }
      // Connect aggregations to hub
      for (const aggId of aggIds) {
        const alreadyConnected = connections.some(c =>
          (c.sourceId === aggId && c.targetId === hub.id) ||
          (c.sourceId === hub.id && c.targetId === aggId)
        );
        if (!alreadyConnected) {
          newConns.push({
            id: createId(),
            sourceId: aggId,
            targetId: hub.id,
            isTotalParticipation: false,
          });
        }
      }
      if (newConns.length > 0) setConnections([...connections, ...newConns]);
      return;
    }

    // Original 2-item connect
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
    if (provider === 'openclaw') {
      if (isTimeout) {
        return 'OpenClaw tardó demasiado en responder. Verifica que el servicio esté activo en el servidor.';
      }
      if (normalizedMessage.includes('failed to fetch') || normalizedMessage.includes('connection refused')) {
        return 'No pude conectar con OpenClaw. Verifica que el servicio esté corriendo en el servidor.';
      }
      if (message && message !== 'ai_request_failed') {
        return `Error de OpenClaw: ${message}`;
      }
      return 'No pude conectar con OpenClaw. Verifica que el servicio esté activo.';
    }
    if (provider === 'openai') {
      if (isTimeout) {
        return 'ChatGPT tardó demasiado en responder. Intenta con un modelo más liviano o un escenario más corto.';
      }
      // The backend returns this exact text when ChatGPT OAuth is not configured.
      // It's a server-side setup step, not a client API key.
      if (normalizedMessage.includes('oauth no configurado')) {
        return 'ChatGPT OAuth no está configurado en este servidor. Cambiá a otro proveedor (Gemini, Grok, Ollama u OpenClaw) en el panel de Configuración, o pedile al admin que ejecute `node scripts/openai-oauth-login.mjs` en el servidor.';
      }
      if (normalizedMessage.includes('unauthorized') || normalizedMessage.includes('401')) {
        return 'ChatGPT rechazó la autenticación (401). El token OAuth expiró o no es válido. Reconfigurá OAuth en el servidor o cambiá de proveedor.';
      }
      if (normalizedMessage.includes('failed to fetch') || normalizedMessage.includes('connection refused')) {
        return 'No pude conectar con ChatGPT. Verifica que el proxy del servidor esté corriendo.';
      }
      if (message && message !== 'ai_request_failed') {
        return `Error de ChatGPT: ${message}`;
      }
      return 'No pude conectar con ChatGPT. Verifica que el proxy del servidor esté corriendo.';
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

  const checkOpenaiHealth = async () => {
    setAiConnectivity(prev => ({ ...prev, openai: 'checking' }));
    setAiConnectivityReason(prev => ({ ...prev, openai: 'Verificando conexión con OpenAI...' }));
    try {
      const response = await fetchWithTimeout('/api/openai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, 2000);
      if (response.ok) {
        const data = await response.json() as { models?: string[] };
        const models = Array.isArray(data?.models)
          ? data.models.filter(model => typeof model === 'string' && model.trim().length > 0)
          : [];
        setOpenaiModels(models);
        setAiConnectivity(prev => ({ ...prev, openai: 'connected' }));
        setAiConnectivityReason(prev => ({
          ...prev,
          openai: models.length > 0
            ? `Modelos detectados: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`
            : 'Conectada, pero no se detectaron modelos compatibles.',
        }));
        return;
      }
      if (response.status === 401) {
        setAiConnectivity(prev => ({ ...prev, openai: 'missing-key' }));
        setOpenaiModels([]);
        setAiConnectivityReason(prev => ({ ...prev, openai: 'OAuth no configurado. Ejecutá: node scripts/openai-oauth-login.mjs' }));
        return;
      }
      const reason = await readApiErrorMessage(response, `OpenAI devolvió HTTP ${response.status}.`);
      setAiConnectivity(prev => ({ ...prev, openai: 'disconnected' }));
      setOpenaiModels([]);
      setAiConnectivityReason(prev => ({ ...prev, openai: reason }));
    } catch {
      setAiConnectivity(prev => ({ ...prev, openai: 'disconnected' }));
      setOpenaiModels([]);
      setAiConnectivityReason(prev => ({ ...prev, openai: 'No se pudo conectar al proxy local de OpenAI.' }));
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
    if (aiProvider !== 'openai') return;
    if (openaiModels.length === 0) return;
    if (openaiModels.includes(aiModel)) return;
    const preferred = ['gpt-4o', 'gpt-4-turbo', 'gpt-4'];
    const nextModel = preferred.find(model => openaiModels.includes(model)) ?? openaiModels[0];
    setAiModel(nextModel);
  }, [aiProvider, aiModel, openaiModels]);

  useEffect(() => {
    let active = true;
    const runChecks = async () => {
      if (!active) return;
      await Promise.all([checkGeminiHealth(), checkGrokHealth(), checkOpenaiHealth(), checkOllamaHealth(), checkOpenclawHealth()]);
    };

    runChecks();
    return () => {
      active = false;
    };
  }, [geminiApiKey, grokApiKey]);

  const getProviderLabel = (provider: AIProvider) =>
    provider === 'gemini' ? 'Gemini' : provider === 'grok' ? 'Grok' : provider === 'ollama' ? 'Ollama' : provider === 'openai' ? 'OpenAI' : 'OpenClaw';

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
    timeoutMs?: number,
    systemPrompt?: string
  ) => {
    const requestUrl =
      provider === 'gemini'
        ? '/api/gemini'
        : provider === 'grok'
          ? '/api/grok'
          : provider === 'openai'
            ? '/api/openai'
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
            : provider === 'openai'
              ? { prompt, model: getProviderModel(provider), ...(systemPrompt ? { systemPrompt } : {}) }
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
    return provider === 'gemini' || provider === 'grok' || provider === 'openai' || provider === 'openclaw'
      ? (typeof data.text === 'string' ? data.text.trim() : '')
      : (typeof data.response === 'string' ? data.response.trim() : '');
  };

  const requestAIText = async (prompt: string, timeoutMs?: number, systemPrompt?: string) => {
    setLastAIFallbackFrom(null);
    const primary = aiProvider;
    const providerOrder: AIProvider[] = [primary, ...(['gemini', 'grok', 'openai', 'ollama', 'openclaw'] as AIProvider[]).filter(p => p !== primary)];

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
        const text = await fetchAITextFromProvider(provider, prompt, timeoutMs, systemPrompt);
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
      `You are an ER modeling expert (Ramakrishnan & Gehrke, 3rd ed.).\n` +
      `Generate up to 5 attributes for the entity "${entityLabel}".\n` +
      `Rules:\n` +
      `- Include exactly one key attribute (simple, uniquely identifies each instance).\n` +
      `- Prefer simple attributes over composite ones.\n` +
      `- For multivalued attributes (e.g. phones, emails), append _list suffix (e.g. telefonos_list).\n` +
      `- For derived attributes (computed from others, e.g. age from birth_date), append _calc suffix.\n` +
      `- Use Spanish snake_case for all names. Maximum 5 attributes including the key.\n` +
      `Respond ONLY with JSON on one line: {"attributes":["key_attr","attr2"],"key":"key_attr"}`;

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

  const detectAndSaveDomain = () => {
    const entityNames = nodes.filter(n => n.type === 'entity').map(n => n.label.toLowerCase());
    if (entityNames.length < 2) return;
    // Simple domain detection based on entity names
    const domainKeywords: Record<string, string[]> = {
      universidad: ['alumno', 'profesor', 'curso', 'materia', 'aula', 'carrera', 'facultad', 'semestre', 'examen', 'nota'],
      hospital: ['paciente', 'medico', 'doctor', 'enfermero', 'cama', 'habitacion', 'diagnostico', 'tratamiento', 'consulta'],
      empresa: ['empleado', 'departamento', 'proyecto', 'cliente', 'proveedor', 'producto', 'factura', 'pedido', 'venta'],
      banco: ['cuenta', 'cliente', 'sucursal', 'prestamo', 'transaccion', 'tarjeta', 'deposito'],
      biblioteca: ['libro', 'autor', 'socio', 'prestamo', 'editorial', 'ejemplar', 'categoria'],
    };
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      const matches = entityNames.filter(e => keywords.some(k => e.includes(k)));
      if (matches.length >= 2) {
        setDomainMemory(prev => ({
          ...prev,
          [domain]: [...new Set([...(prev[domain] || []), ...entityNames])].slice(0, 20),
        }));
        reportDomainToServer(domain, entityNames);
        break;
      }
    }
  };

  const buildDomainBlock = () => {
    if (Object.keys(domainMemory).length === 0) return '';
    const lines = Object.entries(domainMemory).map(([domain, entities]) =>
      `- ${domain}: entidades conocidas: ${entities.join(', ')}`
    );
    return `DOMAIN KNOWLEDGE (from previous sessions):\n${lines.join('\n')}\n\n`;
  };

  const buildFewShotBlock = () => {
    if (fewShotExamples.length === 0) return '';
    const examples = fewShotExamples.slice(-5); // last 5 successful examples
    return `SUCCESSFUL EXAMPLES (follow these patterns):\n${examples.map(ex =>
      `User: ${ex.input.slice(0, 100)}\nResponse: ${ex.output.slice(0, 200)}`
    ).join('\n\n')}\n\n`;
  };

  const ER_RAMAKRISHNAN_THEORY = `ER/EER THEORY — Ramakrishnan & Gehrke, 3rd ed., Ch. 2 (apply strictly)

ENTITIES:
- Strong entity: has its own key that uniquely identifies each instance.
- Weak entity: no own key; depends on owner (strong) entity via an identifying relationship.
  Uses a partial key (discriminator). Mark with set-entity-weakness isWeak:true.

ATTRIBUTES — types and visual encoding:
- Simple: atomic single value (e.g. name, salary).
- Composite: made of sub-components (e.g. address = street + city + zip). Model as separate attributes.
- Multivalued {}: multiple values per instance (e.g. phones, emails). isMultivalued:true.
- Derived /: computed from other attributes (e.g. age from birth_date). isDerived:true.
- Key: underlined; uniquely identifies each instance in the entity set. isKey:true.
- Partial key: discriminator for weak entity (unique only when combined with owner key).

RELATIONSHIPS:
- Binary: between two entity sets (default; most common).
- Ternary (n-ary): among 3+ entity sets simultaneously; use only when the fact truly requires all 3.
- Recursive (self-referential): entity set relates to itself (e.g. Employee supervises Employee).
  Requires distinct roles on each connection (roleA / roleB).
- Identifying relationship: connects a weak entity to its owner; isIdentifying:true.

CARDINALITY CONSTRAINTS (key constraint / ratio):
- 1:1  cardinalityA="1" cardinalityB="1"  — at most one on each side.
- 1:N  cardinalityA="1" cardinalityB="N"  — arrow side is "1" (at most one).
- M:N  cardinalityA="N" cardinalityB="N"  — many on each side.
Heuristic cues for "1": "unique", "only one", "primary", "owner", "the X of Y", "a single".
Heuristic cues for "N": "many", "several", "multiple", "various", "any number of".

PARTICIPATION CONSTRAINTS:
- Total (mandatory / double line): every instance MUST participate. totalA/totalB = true.
  Text cues: "must", "always", "every", "at least one", "required", "cannot exist without".
- Partial (optional / single line): some instances may not participate. totalA/totalB = false.
  Text cues: "may", "can", "optionally", "sometimes", "if applicable".

ISA HIERARCHIES (EER):
Overlap constraint (isDisjoint):
  - Disjoint (d)  isDisjoint:true  — instance belongs to AT MOST ONE subtype.
    Text cues: "either…or", "exclusive", "only one type at a time".
  - Overlapping (o)  isDisjoint:false  — instance can belong to MULTIPLE subtypes.
    Text cues: "can be both", "simultaneously", "more than one role".
Covering constraint (isTotal):
  - Total  isTotal:true  — every supertype instance belongs to AT LEAST ONE subtype.
    Text cues: "always a", "must be classified as", "no uncategorized instances".
  - Partial  isTotal:false  — supertype instance may belong to no subtype.
    Text cues: "may or may not", "not all are typed", "generic instances exist".
Create ISA when: exclusive attributes/relationships exist per subgroup, or text says "types of",
"kinds of", "can be a", "is either a … or a".

AGGREGATION:
Use when a relationship must itself participate in another relationship (treated as entity).
Pattern: {EntityA — RelationshipX — EntityB} [aggregation] — RelationshipY — EntityC.
Text cues: "the relationship between A and B is supervised/monitored by C",
"monitor the assignment of X to Y", "a project involves employees in a task".`.trim();

  const SCENARIO_MASTER_GUIDE =
    `Role: ER/EER modeling assistant (Ramakrishnan & Gehrke, 3rd ed.).\n` +
    `Goal: transform business requirements into a correct, minimal ER/EER model.\n\n` +
    `${ER_RAMAKRISHNAN_THEORY}\n\n` +
    `Mandatory workflow:\n` +
    `1. Extract facts from text ("Each X...", "A Y can...", "Every Z must...").\n` +
    `2. Identify entities, attributes and keys.\n` +
    `3. Identify relationships, cardinality ratios and participation constraints.\n` +
    `4. Evaluate ISA (check overlap and covering constraints per theory above).\n` +
    `5. Evaluate aggregation (relationship as entity).\n` +
    `6. Evaluate n-ary relationships (only when fact requires all N participants simultaneously).\n\n` +
    `If information is missing, infer the minimum reasonable and record assumptions in notes.assumptions.`;

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

    const entityRadiusX = Math.max(160, Math.min(480, 80 + entityEntries.length * 38));
    const entityRadiusY = Math.max(120, Math.min(360, 60 + entityEntries.length * 28));

    entityEntries.forEach((entity, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(entityEntries.length, 1) - Math.PI / 2;
      const pos = {
        x: center.x + Math.cos(angle) * entityRadiusX,
        y: center.y + Math.sin(angle) * entityRadiusY,
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
        const distance = 50 + Math.floor(offsetIndex / 2) * 44;
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
        const distance = 55 + nAryIndex * 25;
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

    // Force-directed pass on entity/relationship/isa nodes to minimize edge crossings
    const structuralNodes = nodes.filter(n => n.type !== 'attribute');
    if (structuralNodes.length >= 3) {
      const nodeIdx = new Map(structuralNodes.map((n, i) => [n.id, i]));
      const count = structuralNodes.length;
      const vx = new Float32Array(count);
      const vy = new Float32Array(count);
      const iterations = 160;
      const initialTemp = 28;

      for (let iter = 0; iter < iterations; iter++) {
        const temp = initialTemp * Math.pow(1 - iter / iterations, 1.5);
        vx.fill(0); vy.fill(0);

        // Repulsion between all structural nodes
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            const dx = structuralNodes[j].position.x - structuralNodes[i].position.x;
            const dy = structuralNodes[j].position.y - structuralNodes[i].position.y;
            const dist2 = Math.max(dx * dx + dy * dy, 1);
            const dist = Math.sqrt(dist2);
            const f = 10000 / dist2;
            vx[i] -= dx / dist * f;  vy[i] -= dy / dist * f;
            vx[j] += dx / dist * f;  vy[j] += dy / dist * f;
          }
        }

        // Spring attraction along connections
        connections.forEach(conn => {
          const ai = nodeIdx.get(conn.sourceId);
          const bi = nodeIdx.get(conn.targetId);
          if (ai === undefined || bi === undefined) return;
          const a = structuralNodes[ai];
          const b = structuralNodes[bi];
          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const ideal = (a.type === 'entity' && b.type === 'entity') ? 320 : 170;
          const spring = 0.045 * (dist - ideal);
          const fx = dx / dist * spring;
          const fy = dy / dist * spring;
          vx[ai] += fx; vy[ai] += fy;
          vx[bi] -= fx; vy[bi] -= fy;
        });

        // Apply displacement capped by temperature
        structuralNodes.forEach((n, i) => {
          const mass = n.type === 'entity' ? 2.5 : 1.2;
          const len = Math.sqrt(vx[i] ** 2 + vy[i] ** 2) || 1;
          const step = Math.min(temp, len);
          n.position.x += (vx[i] / len) * step / mass;
          n.position.y += (vy[i] / len) * step / mass;
        });
      }

      // Sync updated positions back to pendingEntityAttributes / pendingRelationshipAttributes
      pendingEntityAttributes.forEach(entry => {
        const updated = structuralNodes.find(n => n.id === entry.parentId);
        if (updated) entry.parentPosition = { ...updated.position };
      });
      pendingRelationshipAttributes.forEach(entry => {
        const updated = structuralNodes.find(n => n.id === entry.parentId);
        if (updated) entry.parentPosition = { ...updated.position };
      });
    }

    pendingEntityAttributes.forEach(entry => {
      const { attrNodes, attrConnections } = buildAttributeNodes(
        entry.parentId,
        entry.parentPosition,
        entry.attributes,
        entry.keys,
        occupiedNodes,
        120,
        80
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
        100,
        65
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

  const findRelationshipByLabel = (label: string) => {
    const target = label.toLowerCase();
    const node = nodes.find(n => n.type === 'relationship' && n.label.toLowerCase() === target);
    return (node && node.type === 'relationship') ? node : undefined;
  };

  const findConnectionBetween = (idA: string, idB: string) =>
    connections.find(c =>
      (c.sourceId === idA && c.targetId === idB) ||
      (c.sourceId === idB && c.targetId === idA)
    );

  const findAttributeOfEntity = (entity: import('./types/er').EntityNode, attrLabel: string) => {
    const connectedIds = connections
      .filter(c => c.sourceId === entity.id || c.targetId === entity.id)
      .map(c => c.sourceId === entity.id ? c.targetId : c.sourceId);
    const node = nodes.find(n =>
      n.type === 'attribute' &&
      connectedIds.includes(n.id) &&
      n.label.toLowerCase() === attrLabel.toLowerCase()
    );
    return (node && node.type === 'attribute') ? node : undefined;
  };

  const buildDiagramContext = (): string => {
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const parts: string[] = [];

    // ENTITIES
    const entityNodes = nodes.filter(n => n.type === 'entity');
    if (entityNodes.length > 0) {
      const lines = entityNodes.map(entity => {
        const connectedIds = connections
          .filter(c => c.sourceId === entity.id || c.targetId === entity.id)
          .map(c => c.sourceId === entity.id ? c.targetId : c.sourceId);
        const attrs = nodes
          .filter(n => n.type === 'attribute' && connectedIds.includes(n.id))
          .map(n => {
            if (n.type !== 'attribute') return n.label;
            const tags: string[] = [];
            if (n.isKey) tags.push('clave');
            if (n.isMultivalued) tags.push('multivaluado');
            if (n.isDerived) tags.push('derivado');
            return tags.length > 0 ? `${n.label}(${tags.join(',')})` : n.label;
          });
        const weakTag = (entity.type === 'entity' && entity.isWeak) ? '[débil] ' : '';
        return `  ${weakTag}${entity.label}: ${attrs.length > 0 ? attrs.join(', ') : '(sin atributos)'}`;
      });
      parts.push(`ENTIDADES:\n${lines.join('\n')}`);
    }

    // RELATIONSHIPS with their entity connections
    const relNodes = nodes.filter(n => n.type === 'relationship');
    if (relNodes.length > 0) {
      const lines = relNodes.map(rel => {
        // Find connections to/from this relationship
        const relConns = connections.filter(c => c.sourceId === rel.id || c.targetId === rel.id);
        // Separate entity connections from attribute connections
        const entityConns = relConns.filter(c => {
          const otherId = c.sourceId === rel.id ? c.targetId : c.sourceId;
          const other = nodeById.get(otherId);
          return other?.type === 'entity';
        });
        const attrConns = relConns.filter(c => {
          const otherId = c.sourceId === rel.id ? c.targetId : c.sourceId;
          const other = nodeById.get(otherId);
          return other?.type === 'attribute';
        });
        const entityParts = entityConns.map(c => {
          const entityId = c.sourceId === rel.id ? c.targetId : c.sourceId;
          const entity = nodeById.get(entityId);
          if (!entity) return '?';
          const card = c.cardinality ?? '?';
          const total = c.isTotalParticipation ? ':total' : '';
          const role = c.role ? `(${c.role})` : '';
          return `${entity.label}${role} ${card}${total}`;
        });
        const attrLabels = attrConns.map(c => {
          const aId = c.sourceId === rel.id ? c.targetId : c.sourceId;
          return nodeById.get(aId)?.label ?? '?';
        });
        const identifying = (rel.type === 'relationship' && rel.isIdentifying) ? '[identificadora] ' : '';
        const attrStr = attrLabels.length > 0 ? ` | atributos: ${attrLabels.join(', ')}` : '';
        return `  ${identifying}${rel.label}: ${entityParts.join(' — ')}${attrStr}`;
      });
      parts.push(`RELACIONES:\n${lines.join('\n')}`);
    }

    // ISA HIERARCHIES
    const isaNodes = nodes.filter(n => n.type === 'isa');
    if (isaNodes.length > 0) {
      const lines = isaNodes.map(isa => {
        const isaConns = connections.filter(c => c.sourceId === isa.id || c.targetId === isa.id);
        const supertypeIds = isaConns
          .filter(c => c.targetId === isa.id)
          .map(c => nodeById.get(c.sourceId)?.label ?? '?');
        const subtypeIds = isaConns
          .filter(c => c.sourceId === isa.id)
          .map(c => nodeById.get(c.targetId)?.label ?? '?');
        const disjoint = (isa.type === 'isa' && isa.isDisjoint) ? 'disjunto' : 'solapado';
        const total = (isa.type === 'isa' && isa.isTotal) ? 'total' : 'parcial';
        return `  ${supertypeIds.join(',')} → {${subtypeIds.join(', ')}} [${disjoint}, ${total}]`;
      });
      parts.push(`JERARQUÍAS ISA:\n${lines.join('\n')}`);
    }

    // AGGREGATIONS
    if (aggregations.length > 0) {
      const lines = aggregations.map(agg => {
        const members = agg.memberIds.map(id => nodeById.get(id)?.label ?? id);
        return `  [${members.join(' + ')}]${agg.label ? ` (${agg.label})` : ''}`;
      });
      parts.push(`AGREGACIONES:\n${lines.join('\n')}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '(diagrama vacío)';
  };

  const buildRecentHistory = (recentMessages: Array<{ role: 'user' | 'assistant'; text: string }>): string => {
    if (recentMessages.length === 0) return '';
    const lines = recentMessages.map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.text}`).join('\n');
    return `\nConversación reciente:\n${lines}\n`;
  };

  // -------------- Domain-aware prompts (view-scoped chat) --------------

  /** Compact list of relational tables with column types and PK/FK markers. */
  const buildRelationalSchemaSummary = (): string => {
    if (!relationalSchema || relationalSchema.tables.length === 0) return '(no hay tablas en el esquema)';
    return relationalSchema.tables.map(t => {
      const cols = t.columns.filter(c => !c.isDerived).map(c => {
        const flags = [c.isPrimaryKey ? 'PK' : null, c.isForeignKey ? `FK→${c.referencedTable}` : null].filter(Boolean).join(',');
        return flags ? `${c.name}(${flags})` : c.name;
      }).join(', ');
      return `  ${t.name}: ${cols}`;
    }).join('\n');
  };

  /** Read the algebra tab's state from localStorage to enrich the prompt.
   *  Includes the full row data per relation (capped per safety) so the AI
   *  can reason about ABM operations against the actual values. */
  const buildAlgebraStateSummary = (): { query: string; relations: string } => {
    try {
      const raw = localStorage.getItem('derup.algebra.v1');
      if (!raw) return { query: '', relations: '' };
      const parsed = JSON.parse(raw) as {
        query?: string;
        tablesData?: Record<string, { columns: { name: string; type: string }[]; rows: unknown[][] }>;
        importedRelations?: Record<string, { columns: { name: string; type: string }[]; rows: unknown[][] }>;
      };
      const MAX_ROWS_PER_REL = 200; // safety cap so a giant CSV doesn't blow tokens
      const blocks: string[] = [];
      const dump = (name: string, r: { columns: { name: string; type: string }[]; rows: unknown[][] }) => {
        const head = `${name} (${r.rows.length} filas) — columnas: ${r.columns.map(c => `${c.name}:${c.type}`).join(', ')}`;
        const cap = Math.min(r.rows.length, MAX_ROWS_PER_REL);
        const truncated = r.rows.length > MAX_ROWS_PER_REL
          ? `  …(${r.rows.length - MAX_ROWS_PER_REL} filas más omitidas)\n`
          : '';
        const rowsCsv = r.rows.slice(0, cap)
          .map((row, i) => `  [${i}] ${row.map(v => v === null ? 'NULL' : JSON.stringify(v)).join(', ')}`)
          .join('\n');
        blocks.push(`${head}\n${rowsCsv}\n${truncated}`);
      };
      Object.entries(parsed.tablesData ?? {}).forEach(([n, r]) => dump(n, r));
      Object.entries(parsed.importedRelations ?? {}).forEach(([n, r]) => dump(n, r));
      return { query: parsed.query ?? '', relations: blocks.join('\n\n') };
    } catch { return { query: '', relations: '' }; }
  };

  const buildSchemaPrompt = (recentMessages: Array<{ role: 'user' | 'assistant'; text: string }>): string =>
    `Sos un experto en modelo relacional ayudando al usuario en la pestaña "Esquema Relacional" de derup.\n` +
    `La pestaña deriva automáticamente las tablas a partir del diagrama ER. Aplicá teoría de Codd / Ramakrishnan & Gehrke.\n\n` +
    `RESPUESTA: SIEMPRE devolvé JSON exactamente con esta forma — nada más:\n` +
    `{"type":"chat","message":"tu respuesta en castellano"}\n\n` +
    `No emitas comandos de mutación de ER (add-entity, connect-entities, etc.) en esta pestaña — esas pertenecen a la pestaña ER.\n\n` +
    `Esquema relacional actual:\n${buildRelationalSchemaSummary()}\n\n` +
    `Temas para ayudar al usuario: justificación de cada tabla derivada del ER, normalización (1FN, 2FN, 3FN, BCNF, 4FN), dependencias funcionales, claves candidatas/foráneas, decomposición sin pérdida, denormalización con tradeoffs, integridad referencial.\n` +
    buildRecentHistory(recentMessages);

  const buildSQLPrompt = (recentMessages: Array<{ role: 'user' | 'assistant'; text: string }>): string =>
    `Sos un experto en SQL ayudando al usuario en la pestaña "SQL DDL" de derup.\n` +
    `derup generó este DDL a partir del esquema relacional:\n\`\`\`sql\n${(sqlDDL || '-- (vacío)').slice(0, 4000)}\n\`\`\`\n\n` +
    `RESPUESTA: SIEMPRE devolvé JSON exactamente con esta forma — nada más:\n` +
    `{"type":"chat","message":"tu respuesta en castellano"}\n\n` +
    `No emitas comandos de mutación de ER en esta pestaña.\n\n` +
    `Podés ayudar con: revisión del DDL (tipos, constraints, ON DELETE), índices recomendados según el patrón de queries, queries de ejemplo (SELECT/JOIN/GROUP/HAVING), traducción de queries en castellano a SQL, optimización (planes de ejecución, sargability), portabilidad entre dialectos (PostgreSQL/MySQL/SQLite/Oracle).\n` +
    `Cuando muestres SQL, usá bloques con \`\`\`sql ... \`\`\` dentro del campo message.\n` +
    buildRecentHistory(recentMessages);

  const buildAlgebraPrompt = (recentMessages: Array<{ role: 'user' | 'assistant'; text: string }>): string => {
    const { query, relations } = buildAlgebraStateSummary();
    return `Sos un asistente de álgebra relacional integrado en derup. Tu trabajo es HACER, no explicar.\n` +
      `Aplicá teoría de Ramakrishnan & Gehrke Cap 4 cuando armás las consultas.\n\n` +
      `RESPONDÉ CON UN ÚNICO JSON (sin markdown, sin texto fuera del JSON). Hay 4 formas posibles:\n\n` +
      `1) algebra-query — pedido EJECUTABLE de consulta:\n` +
      `   {"type":"algebra-query","query":"<consulta>","run":true,"message":"<frase breve>"}\n` +
      `   Inserta la consulta en el editor y la ejecuta. Ejemplos:\n` +
      `     Usuario: "ver todos los registros de emp"\n` +
      `     → {"type":"algebra-query","query":"emp","run":true,"message":"Mostrando emp."}\n` +
      `     Usuario: "empleados con edad mayor a 30"\n` +
      `     → {"type":"algebra-query","query":"σ age > 30 (emp)","run":true,"message":"Filtrados."}\n` +
      `     Usuario: "qué empleados trabajan en algún departamento"\n` +
      `     → {"type":"algebra-query","query":"emp ⋈ works","run":true,"message":"Junta natural."}\n\n` +
      `2) algebra-data — ABM (alta/baja/modificación) de datos:\n` +
      `   El usuario va a CONFIRMAR siempre antes de aplicar, así que podés ser asertivo.\n` +
      `   Usá los DATOS COMPLETOS provistos abajo para inferir el contexto (qué eid existen, qué did, etc.).\n` +
      `   Acciones disponibles:\n` +
      `     append — agregar filas a una relación existente:\n` +
      `       {"type":"algebra-data","action":"append","relation":"works","rows":[[1,1],[1,2],[1,3]],"message":"3 filas nuevas para que la división dé resultado."}\n` +
      `       Cada \\\`row\\\` es un array de valores en el ORDEN de las columnas tal como aparecen en el contexto.\n` +
      `     replace — reemplazar todas las filas de una relación:\n` +
      `       {"type":"algebra-data","action":"replace","relation":"emp","rows":[[1,"Ana",30,50000],[2,"Luis",45,60000]],"message":"Reset de emp con 2 empleados."}\n` +
      `     update-row — modificar una fila existente (índice 0-based):\n` +
      `       {"type":"algebra-data","action":"update-row","relation":"emp","rowIndex":0,"values":{"salary":80000,"age":31},"message":"Actualicé el sueldo y edad de la fila 0."}\n` +
      `     delete-rows — eliminar filas por índice (0-based, podés pasar varios):\n` +
      `       {"type":"algebra-data","action":"delete-rows","relation":"emp","rowIndices":[3,5],"message":"Borradas 2 filas."}\n` +
      `     create-relation — crear una relación nueva con esquema + datos:\n` +
      `       {"type":"algebra-data","action":"create-relation","relation":"salario_hist","columns":[{"name":"eid","type":"number"},{"name":"anio","type":"number"},{"name":"monto","type":"number"}],"rows":[[1,2024,50000],[1,2025,55000]],"message":"Tabla nueva con histórico."}\n\n` +
      `   IMPORTANTE para algebra-data:\n` +
      `   - Las \\\`rows\\\` deben respetar EXACTAMENTE el orden de columnas mostradas en el contexto.\n` +
      `   - Los tipos deben coincidir: si la columna es number, el valor es number; si es string, string entre comillas en el JSON. null para vacío.\n` +
      `   - Cuando el usuario pide "completá datos para que tal query dé resultado", ANALIZÁ la query, mirá los datos existentes, y generá las filas mínimas necesarias. No expliques: emitis el comando.\n\n` +
      `3) chat — solo para CONCEPTUAL (qué es algo, por qué tal regla):\n` +
      `   {"type":"chat","message":"<respuesta en castellano>"}\n\n` +
      `ITERACIÓN SOBRE LA CONSULTA ACTUAL:\n` +
      `Cuando el usuario da feedback sobre la consulta que TIENE ABIERTA en el editor (mostrada abajo),\n` +
      `tu trabajo es REESCRIBIRLA mejorada y devolverla como algebra-query. Nunca expliques en prosa.\n` +
      `Casos típicos:\n` +
      `  - "falta la proyección" / "agregame un π" / "sólo quiero los nombres" / "limitá las columnas"\n` +
      `    → tomá la consulta actual y envolvela con π de las columnas adecuadas.\n` +
      `      Ej. actual: emp ⋈ (π eid,did(works) ÷ π did(dept))\n` +
      `          pedido: "falta la proyección al nombre"\n` +
      `          → {"type":"algebra-query","query":"π ename (emp ⋈ (π eid,did(works) ÷ π did(dept)))","run":true,"message":"Agregué π ename al resultado."}\n` +
      `  - "ordená por X" → no es álgebra estándar; respondé con chat explicando.\n` +
      `  - "agregá un filtro de age > 30" → envolvé con σ adecuado.\n` +
      `  - "está mal el operador" / "tendría que ser un join no un cross" → emití la consulta corregida.\n\n` +
      `PROYECCIONES FINALES INTELIGENTES (cuando ARMÁS la consulta de cero):\n` +
      `  - "qué empleados / cuáles empleados X" → terminá con π ename(...) en lugar de devolver todas las columnas de emp.\n` +
      `  - "qué departamentos X" → π dname(...).\n` +
      `  - "cuántos X" → no hay COUNT en álgebra clásica; respondé con chat aclarando o devolvé la consulta sin proyección.\n` +
      `  - "lista TODO de X" → sin proyección final (devolvé el join completo).\n\n` +
      `Nunca emitas comandos de mutación de ER (add-entity, connect-entities, etc.) — esta pestaña es solo álgebra y datos.\n\n` +
      `RELACIONES DISPONIBLES (del esquema + importadas como CSV):\n${relations || buildRelationalSchemaSummary()}\n\n` +
      (query ? `CONSULTA ACTUAL EN EL EDITOR DEL USUARIO:\n\`\`\`\n${query.slice(0, 2000)}\n\`\`\`\n\n` : '') +
      `OPERADORES SOPORTADOS POR derup (mostrá ambas sintaxis cuando enseñes — Unicode primero, ASCII en paréntesis):\n` +
      `  σ_{cond}(R)  o  σ cond (R)   — selección (también ASCII: select_{cond}(R) o select cond (R))\n` +
      `  π_{c1,c2}(R) o  π c1,c2 (R)  — proyección (also project)\n` +
      `  ρ_{NewName}(R) o ρ NewName (R) — renombrar relación (also rename)\n` +
      `  ρ_{a→a1,b→b1}(R)              — renombrar columnas\n` +
      `  R ⋈ S                          — junta natural (also join)\n` +
      `  R ⋈_{cond} S                   — theta join (also join_{cond})\n` +
      `  R ⨯ S                          — producto cartesiano (also cross)\n` +
      `  R ÷ S                          — división (also division)\n` +
      `  R ∪ S, R ∩ S, R − S            — unión, intersección, diferencia (also union, intersect, difference)\n` +
      `  R := σ_{...}(...)              — asignación a relación derivada (reusable en queries siguientes)\n` +
      `  Conectores lógicos en condiciones: ∧ ∨ ¬ (and / or / not)\n` +
      `  Comparadores: = ≠ < > ≤ ≥ (también != <= >=)\n` +
      `  Cualificación de columnas: R.col cuando hay colisiones tras ⨯ o θ-join\n\n` +
      `CONVENCIONES DE CARDINALIDAD: derup usa convención de PARTICIPACIÓN (De Miguel/Piattini): la cardinalidad pegada a una entidad describe cuántas veces ESA entidad participa en la relación (no la del otro lado).\n\n` +
      `UNION-COMPATIBILITY (∪ ∩ −): igual aridad + mismos dominios por posición; los NOMBRES de columna pueden diferir (toma los del operando izquierdo).\n\n` +
      `DIVISIÓN (R ÷ S): S debe ser subconjunto ESTRICTO del esquema de R (al menos una columna en R que no esté en S, mismos tipos por nombre).\n\n` +
      `Temas para ayudar: explicar operadores con ejemplos, traducir consultas en castellano al álgebra, depurar consultas erróneas del usuario, mostrar el árbol de ejecución paso a paso, sugerir equivalencias y optimizaciones (push-down de σ, asociatividad de ⋈, etc.), conversión SQL ↔ álgebra.\n` +
      `Cuando muestres consultas de álgebra, encerralas en \`\`\` ... \`\`\` para que se vea con la fuente correcta.\n` +
      buildRecentHistory(recentMessages);
  };

  const buildAISystemPrompt = (
    recentMessages: Array<{ role: 'user' | 'assistant'; text: string }>,
    view: 'er' | 'schema' | 'sql' | 'algebra' = 'er',
  ): string => {
    if (view === 'schema') return buildSchemaPrompt(recentMessages);
    if (view === 'sql') return buildSQLPrompt(recentMessages);
    if (view === 'algebra') return buildAlgebraPrompt(recentMessages);
    // 'er' → existing full prompt below
    return (
    `You are the ER modeling assistant of derup. Apply Ramakrishnan & Gehrke theory strictly.\n` +
    `Respond with valid JSON only, no markdown.\n` +
    `Single operation → one JSON object: {"type":"..."}.\n` +
    `Multiple operations (scenarios, batch changes, reviews) → JSON array: [{"type":"..."},{"type":"..."},...].\n` +
    `COMPLEX SCENARIOS: When the user describes a full data model, generate ALL commands needed — entities, attributes, connections, ISA, weak entities, etc. There is NO command limit. Generate as many commands as needed to model the entire scenario completely.\n` +
    `If you cannot fit everything, add as last element: {"type":"chat","message":"CONTINUE"} — the system will automatically ask you to continue.\n` +
    `Otherwise, add as last element: {"type":"chat","message":"summary in Spanish"}.\n\n` +
    `${ER_RAMAKRISHNAN_THEORY}\n\n` +
    `DECISION HEURISTICS (apply before choosing command type):\n` +
    `- Weak entity? → set-entity-weakness isWeak:true. NOTE: identifying relationship ≠ recursive relationship.\n` +
    `- Ternary relationship (3 entities participate)? → connect-entities with entityA, entityB, AND entityC. Example: Professors teach Subjects on Days → entityA="Professors", entityB="Subjects", entityC="Days".\n` +
    `- Recursive/self-relationship (entity relates to itself)? → connect-entities with entityA===entityB, set roleA and roleB. This is NOT an identifying relationship.\n` +
    `- Identifying relationship? → ONLY used when connecting a WEAK entity to its STRONG owner entity.\n` +
    `- Multivalued attribute? → add the attribute first, then set-attribute-type isMultivalued:true.\n` +
    `- Derived attribute? → add the attribute first, then set-attribute-type isDerived:true.\n` +
    `- ISA? → create-isa with isDisjoint and isTotal determined by R&G overlap/covering rules above.\n` +
    `- Aggregation? → connect-entity-aggregation with the base relationship's two member entities.\n` +
    `- Cardinality ambiguous? → default M:N ("N","N"); adjust only when text clearly implies constraint.\n` +
    `- "restricción de clave" / "key constraint" on entity X → set-cardinality with "1" on X's side. Means each X participates in at most one relationship instance (arrow). NEVER interpret as replacing attributes.\n` +
    `- "participación total" / "total participation" of entity X → set-participation isTotal:true (double/thick line). Means EVERY instance of X must participate.\n` +
    `- "entidad débil" / "weak entity" X → set-entity-weakness isWeak:true. Requires identifying relationship to owner.\n` +
    `- "marcar como clave" / "hacer clave" attribute A of X → set-attribute-type isKey:true.\n` +
    `- "atributo multivaluado" / "multivalued" A of X → set-attribute-type isMultivalued:true.\n` +
    `- "atributo derivado" / "derived" A of X → set-attribute-type isDerived:true.\n` +
    `- "cardinalidad 1:N" between X and Y → set-cardinality entityA=X entityB=Y cardinalityA="1" cardinalityB="N".\n` +
    `- "rol" of X in R → set-connection-role entityName=X relationshipName=R role="the role".\n\n` +
    (buildModelingHintsBlock() ? `LEARNED RULES (from past modeling errors — never repeat these):\n${buildModelingHintsBlock()}\n` : '') +
    buildFewShotBlock() +
    buildDomainBlock() +
    `Current diagram state:\n${buildDiagramContext()}\n` +
    (lastScenarioText
      ? `\nOriginal scenario used to generate this diagram:\n"""\n${lastScenarioText}\n"""\n`
      : `\nNo original scenario text available. When answering questions about diagram decisions, infer the implied domain from entity names, relationship names, attributes, cardinalities, and structural patterns (weak entities, ISA hierarchies, aggregations) visible in the current diagram. Use that inferred domain as context to explain each decision with R&G theory.\n`) +
    buildRecentHistory(recentMessages) +
    `\nJSON "type" values (use exactly one per response):\n` +
    `add-entity: {"type":"add-entity","entityName":"X","attributes":["a","b"],"keyAttributes":["a"]}\n` +
    `add-attributes (to entity or relationship): {"type":"add-attributes","entityName":"X","attributes":["c","d"],"keyAttributes":[]}\n` +
    `add-attributes (typical/default, no list given): {"type":"add-attributes","entityName":"X","attributes":[],"useDefaultAttributes":true}\n` +
    `replace-attributes (entity or relationship — replaces ALL existing): {"type":"replace-attributes","entityName":"X","attributes":["a","b"],"keyAttributes":["a"]}\n` +
    `rename-entity: {"type":"rename-entity","entityName":"Old","newName":"New"}\n` +
    `rename-relationship: {"type":"rename-relationship","relationshipName":"Old","newName":"New"}\n` +
    `connect-entities (binary): {"type":"connect-entities","entityA":"A","entityB":"B","relationshipName":"R","cardinalityA":"1","cardinalityB":"N","totalA":false,"totalB":true,"roleA":"r1","roleB":"r2"}\n` +
    `connect-entities (ternary): {"type":"connect-entities","entityA":"A","entityB":"B","entityC":"C","relationshipName":"R","cardinalityA":"N","cardinalityB":"N","cardinalityC":"N"}\n` +
    `connect-entity-aggregation: {"type":"connect-entity-aggregation","entityName":"C","aggregationEntityA":"A","aggregationEntityB":"B","relationshipName":"monitors"}\n` +
    `set-entity-weakness: {"type":"set-entity-weakness","entityName":"X","isWeak":true}\n` +
    `set-cardinality: {"type":"set-cardinality","entityA":"A","entityB":"B","cardinalityA":"1","cardinalityB":"N"}\n` +
    `set-participation: {"type":"set-participation","entityName":"A","relationshipName":"R","isTotal":true}\n` +
    `set-attribute-type: {"type":"set-attribute-type","entityName":"X","attributeName":"phones","isMultivalued":true}\n` +
    `set-connection-role: {"type":"set-connection-role","entityName":"X","relationshipName":"R","role":"supervisor"}\n` +
    `create-isa: {"type":"create-isa","supertype":"Person","subtypes":["Student","Employee"],"isDisjoint":true,"isTotal":false}\n` +
    `delete-entity: {"type":"delete-entity","entityName":"X"}\n` +
    `delete-relationship: {"type":"delete-relationship","relationshipName":"R"}\n` +
    `clear-diagram: {"type":"clear-diagram"}\n` +
    `chat: {"type":"chat","message":"Response in Spanish for the user"}\n\n` +
    `Rules:\n` +
    `- Use "chat" for: greetings, general ER theory questions, questions about this diagram's decisions, review/audit requests, and unmappable requests.\n` +
    `- Questions about diagram decisions (why weak entity, why aggregation, why ISA, what are the assumptions, etc.):\n` +
    `  Cross-reference the original scenario text with the current diagram state.\n` +
    `  Explain each decision citing the exact R&G concept applied (R&G Ch.2 rule) and the specific sentence/fact in the scenario that triggered it.\n` +
    `  If multiple design alternatives exist, mention them and justify why the chosen one is correct per R&G.\n` +
    `  Structure the answer clearly (one paragraph or bullet per decision). Answer in Spanish.\n` +
    `- Review/audit requests (revisar modelo, buscar errores, verificar modelado, sugerir mejoras, etc.):\n` +
    `  Perform a structured R&G audit of the current diagram. Check ALL of the following:\n` +
    `  1. ENTITIES: every strong entity has a key attribute; every weak entity has a partial key and an identifying relationship.\n` +
    `  2. ATTRIBUTES: no multivalued attribute is stored as simple; derived attributes are marked derived; composite attributes are decomposed.\n` +
    `  3. RELATIONSHIPS: cardinality ratios match the scenario constraints; total participation is marked where "every instance must" participate.\n` +
    `  4. ISA: overlap constraint (disjoint/overlapping) and covering constraint (total/partial) are correct per scenario text.\n` +
    `  5. AGGREGATION vs TERNARY: aggregation is used only when a relationship itself participates in another relationship; not as a substitute for a ternary.\n` +
    `  6. MISSING CONSTRUCTS: entities/relationships/attributes implied by the scenario but absent from the diagram.\n` +
    `  7. REDUNDANCY: relationships or attributes that duplicate information already captured.\n` +
    `  Format: numbered list, each item = [SEVERITY: ERROR|WARNING|SUGGESTION] — element name — description — R&G rule violated or improvement basis. Answer in Spanish.\n` +
    `- Entity/relationship names must match the diagram EXACTLY (case-insensitive).\n` +
    `- CRITICAL — REFERENCE RESOLUTION: Words like "existentes", "las entidades", "las tres entidades", "entre ellas", "todas" are REFERENCES to entities listed in "Current diagram state" above. They are NEVER entity names. You MUST resolve them to the actual entity names.\n` +
    `  Example: If diagram has entities Profesores, Alumnos, Aulas and user says "crear relación ternaria entre las tres entidades existentes" → use connect-entities with entityA="Profesores", entityB="Alumnos", entityC="Aulas". NEVER create an entity named "Existentes".\n` +
    `  Example: If diagram has entities A, B and user says "relacionar las entidades" → use connect-entities with entityA="A", entityB="B".\n` +
    `- CRITICAL: When user lists multiple items separated by commas or "y" (e.g. "agregar entidades: profesores, cursos, aulas" or "crear profesor y alumno"), each item is a SEPARATE entity. Return a JSON ARRAY with one add-entity per item. NEVER combine them into one entity.\n` +
    `- If user says "agregar entidad X" without attributes, infer logical attributes for X based on its domain meaning (e.g. Persona → persona_id, nombre, apellido, fecha_nacimiento; Curso → curso_id, nombre, descripcion). Use useDefaultAttributes:true.\n` +
    `- If user provides explicit attributes, use EXACTLY those — do not add or remove any.\n` +
    `- If user asks for typical/own attributes without listing them, use useDefaultAttributes:true and attributes:[].\n` +
    `- If user lists concrete attributes, use snake_case in the attributes array.\n` +
    `- For set-attribute-type, attributeName must match an existing attribute in the diagram.\n` +
    `- NEVER use descriptive phrases like "own attributes of X" as an attribute name.\n` +
    `- add-attributes and replace-attributes work for BOTH entities and relationships — put the relationship name in entityName.\n` +
    `- To add attributes to a relationship (e.g. Detalle_comprobante): {"type":"add-attributes","entityName":"Detalle_comprobante","attributes":["precio","descuento","total"],"keyAttributes":[]}\n` +
    `- To replace/fix attributes of a weak entity (e.g. remove wrong key, add correct partial key): use replace-attributes with the correct attributes and keyAttributes list.\n`
    );
  };

  /** Human-readable summary of an algebra-data command, shown in the
   *  confirmation dialog so the user knows what's about to change. */
  const describeAlgebraDataCmd = (cmd: AICommand & { type: 'algebra-data' }): string => {
    const head = `Acción: ${cmd.action} · Relación: ${cmd.relation}`;
    switch (cmd.action) {
      case 'append':
        return `${head}\nFilas a agregar: ${cmd.rows?.length ?? 0}\n${(cmd.rows ?? []).slice(0, 5).map(r => '  + ' + JSON.stringify(r)).join('\n')}${(cmd.rows?.length ?? 0) > 5 ? `\n  …(${(cmd.rows!.length - 5)} más)` : ''}`;
      case 'replace':
        return `${head}\nReemplazar TODAS las filas existentes por ${cmd.rows?.length ?? 0} filas.\n${(cmd.rows ?? []).slice(0, 5).map(r => '  = ' + JSON.stringify(r)).join('\n')}${(cmd.rows?.length ?? 0) > 5 ? `\n  …(${(cmd.rows!.length - 5)} más)` : ''}`;
      case 'update-row':
        return `${head}\nModificar fila ${cmd.rowIndex} con: ${JSON.stringify(cmd.values ?? {})}`;
      case 'delete-rows':
        return `${head}\nEliminar ${cmd.rowIndices?.length ?? 0} fila(s): índices ${(cmd.rowIndices ?? []).join(', ')}`;
      case 'create-relation':
        return `${head}\nCrear relación NUEVA con columnas: ${(cmd.columns ?? []).map(c => `${c.name}:${c.type}`).join(', ')}\nFilas iniciales: ${cmd.rows?.length ?? 0}`;
    }
  };

  const triggerAIContinuation = async () => {
    setAiStatus('thinking');
    setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: 'Continuando con el modelo...' }]);
    try {
      const recentHistory = chatMessages.slice(-8).map(m => ({ role: m.role, text: m.text }));
      const systemPrompt = buildAISystemPrompt(recentHistory, canvasView);
      const continuePrompt = 'Continue generating the remaining commands for the scenario. The diagram already has the entities and connections shown in the current diagram state. Generate ONLY the missing elements (entities, attributes, connections, ISA, etc.) that have not been created yet. Do NOT recreate existing elements.';
      const aiText = aiProvider === 'openai'
        ? await requestAIText(continuePrompt, undefined, systemPrompt)
        : await requestAIText(systemPrompt + '\n\n' + continuePrompt);
      const aiResponseText = aiText ?? '';
      if (aiResponseText) {
        const batch = parseAICommandBatch(aiResponseText);
        if (batch && batch.length > 0) {
          batchQueueRef.current = batch;
          setBatchProgress({ current: 0, total: batch.length });
          setTimeout(() => setBatchTick(t => t + 1), 80);
          return;
        }
        const singleCmd = parseAICommandJson(aiResponseText);
        if (singleCmd) {
          if (singleCmd.type === 'chat') {
            setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: singleCmd.message }]);
          } else {
            const { nodes: nextNodes, connections: nextConns, message } = applyCommandToState(singleCmd, nodesRef.current, connectionsRef.current);
            setNodes(nextNodes);
            setConnections(nextConns);
            setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: message }]);
          }
        }
      }
    } catch (error) {
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Error al continuar: ${describeAIError(error, aiProvider)}` }]);
    } finally {
      setAiStatus('idle');
    }
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

  const joinRoom = (rid: string, asOwner = false) => {
    if (wsRef.current) wsRef.current.close();
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/?room=${rid}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setRoomId(rid);

    ws.onopen = () => {
      if (asOwner) {
        // Push current diagram to the new room instead of receiving empty state
        ws.send(JSON.stringify({ type: 'update', nodes, connections, aggregations }));
      }
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { type: string; nodes?: ERNode[]; connections?: Connection[]; aggregations?: Aggregation[] };
      if (msg.type === 'state' && !asOwner) {
        // Initial state from server — full replace
        isSyncingRef.current = true;
        if (Array.isArray(msg.nodes)) setNodes(msg.nodes);
        if (Array.isArray(msg.connections)) setConnections(msg.connections);
        if (Array.isArray(msg.aggregations)) setAggregations(msg.aggregations);
        setTimeout(() => { isSyncingRef.current = false; }, 50);
      } else if (msg.type === 'update') {
        // Incremental merge — don't overwrite local edits
        isSyncingRef.current = true;
        if (Array.isArray(msg.nodes)) {
          setNodes(prev => {
            const remoteById = new Map(msg.nodes!.map(n => [n.id, n]));
            const localIds = new Set(prev.map(n => n.id));
            // Keep local nodes, update with remote changes, add new remote nodes
            const merged = prev.map(n => remoteById.get(n.id) ?? n);
            // Add nodes that exist remotely but not locally
            for (const rn of msg.nodes!) {
              if (!localIds.has(rn.id)) merged.push(rn);
            }
            // Remove nodes that were deleted remotely
            const remoteIds = new Set(msg.nodes!.map(n => n.id));
            return merged.filter(n => remoteIds.has(n.id) || !localIds.has(n.id));
          });
        }
        if (Array.isArray(msg.connections)) {
          setConnections(prev => {
            const remoteById = new Map(msg.connections!.map(c => [c.id, c]));
            const localIds = new Set(prev.map(c => c.id));
            const merged = prev.map(c => remoteById.get(c.id) ?? c);
            for (const rc of msg.connections!) {
              if (!localIds.has(rc.id)) merged.push(rc);
            }
            const remoteIds = new Set(msg.connections!.map(c => c.id));
            return merged.filter(c => remoteIds.has(c.id) || !localIds.has(c.id));
          });
        }
        if (Array.isArray(msg.aggregations)) setAggregations(msg.aggregations!);
        setTimeout(() => { isSyncingRef.current = false; }, 50);
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
    joinRoom(data.roomId, true);
  };

  const sendUpdateDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isSyncingRef.current) return;
    if (sendUpdateDebounceRef.current) clearTimeout(sendUpdateDebounceRef.current);
    sendUpdateDebounceRef.current = window.setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && !isSyncingRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'update', nodes, connections, aggregations }));
      }
    }, 300);
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

    // Auto-learn: detect user corrections and save as hints
    const correctionPattern = /^(?:no[, ]+|mal[, ]+|interpretaste?\s+mal|eso\s+no|no\s+(?:es|era|quiero|quise|pedí)|está\s+mal|incorrecto|error[, ]+)/i;
    if (correctionPattern.test(normalizedText) && lastAIInteraction.current) {
      const { userInput, commandType } = lastAIInteraction.current;
      const correction = text.replace(correctionPattern, '').trim();
      if (correction.length > 5) {
        const hint = `Cuando el usuario dice "${userInput.slice(0, 80)}", NO usar ${commandType}. Lo correcto: ${correction.slice(0, 120)}`;
        reportHintToServer(hint);
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `📝 Reportado (se necesitan 3 reportes para que se vuelva regla). Corrección: "${correction}"` }]);
        lastAIInteraction.current = null;
        return;
      }
    }
    // If last interaction wasn't corrected → it was successful → save as few-shot example
    if (lastAIInteraction.current && !correctionPattern.test(normalizedText)) {
      const { userInput, aiOutput } = lastAIInteraction.current;
      if (userInput && aiOutput && (aiOutput.startsWith('{') || aiOutput.startsWith('['))) {
        reportExampleToServer(userInput, aiOutput);
      }
      lastAIInteraction.current = null;
    }

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
      // Report manually — counts as 3 (immediate promotion)
      for (let i = 0; i < 3; i++) reportHintToServer(hint);
      setModelingHints(prev => {
        const exists = prev.some(item => item.toLowerCase() === hint.toLowerCase());
        if (exists) return prev;
        return [hint, ...prev].slice(0, 20);
      });
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Regla guardada (promovida inmediatamente): "${hint}"` }]);
      return;
    }

    const entityLabels = nodes.filter(n => n.type === 'entity').map(n => n.label);
    const explicitCommandIntent = /\b(agregar|crear|añadir|anadir|add|create)\b/i.test(text);
    const scenarioDetected = looksLikeScenario(text) && !explicitCommandIntent;
    let parsed = scenarioDetected ? null : parseChatCommand(text, entityLabels);
    let aiResponseText = '';
    let aiCommand: AICommand | null = null;

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
        setTimeout(() => fitNodesToScreen(scenarioNodes), 50);

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
        setLastScenarioText(text);

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
        // Pre-process: resolve entity/relationship references to actual diagram names
        const resolvedText = (() => {
          let t = text;
          const entityNames = nodes.filter(n => n.type === 'entity').map(n => n.label);
          const relNames = nodes.filter(n => n.type === 'relationship').map(n => n.label);
          // Replace "las N entidades existentes", "las entidades", "todas las entidades", "entre ellas"
          const entityRefPattern = /(?:las\s+(?:\d+\s+)?entidades?\s*(?:existentes?|del\s+diagrama|actuales)?|todas\s+las\s+entidades|entre\s+ellas)/gi;
          if (entityRefPattern.test(t) && entityNames.length > 0) {
            const nameList = entityNames.length === 2
              ? entityNames.join(' y ')
              : entityNames.slice(0, -1).join(', ') + ' y ' + entityNames[entityNames.length - 1];
            t = t.replace(entityRefPattern, nameList);
          }
          // Replace "las relaciones existentes"
          const relRefPattern = /(?:las\s+(?:\d+\s+)?relaciones?\s*(?:existentes?|del\s+diagrama|actuales)?)/gi;
          if (relRefPattern.test(t) && relNames.length > 0) {
            t = t.replace(relRefPattern, relNames.join(', '));
          }
          return t;
        })();

        const recentHistory = chatMessages.slice(-8).map(m => ({ role: m.role, text: m.text }));
        const systemPrompt = buildAISystemPrompt(recentHistory, canvasView);
        const userPrompt = `User: ${resolvedText}`;
        // For providers that support separate instructions (ChatGPT), send systemPrompt separately
        // For others, concatenate into a single prompt
        const aiText = aiProvider === 'openai'
          ? await requestAIText(userPrompt, undefined, systemPrompt)
          : await requestAIText(systemPrompt + '\n\n' + userPrompt);
        aiResponseText = aiText ?? '';
        if (aiResponseText) {
          const batch = parseAICommandBatch(aiResponseText);
          if (batch && batch.length > 1) {
            batchQueueRef.current = batch;
            setBatchProgress({ current: 0, total: batch.length });
            setTimeout(() => setBatchTick(t => t + 1), 80);
            return;
          }
          aiCommand = parseAICommandJson(aiResponseText);
        }
        // Track interaction for auto-learn
        if (aiCommand) {
          lastAIInteraction.current = { userInput: text, aiOutput: aiResponseText, commandType: aiCommand.type };
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
    // Algebra-query: inject into editor and (by default) auto-execute.
    if (aiCommand?.type === 'algebra-query') {
      const run = aiCommand.run ?? true;
      setPendingAlgebraQuery({ query: aiCommand.query, run, at: Date.now() });
      // Make sure the user sees the result in the Algebra panel.
      if (canvasView !== 'algebra') setCanvasView('algebra');
      const msg = aiCommand.message?.trim() || 'Consulta lista en el editor.';
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `${msg} \n\`\`\`\n${aiCommand.query}\n\`\`\`` }]);
      return;
    }
    // Algebra-data: ABM with confirmation.
    if (aiCommand?.type === 'algebra-data') {
      const summary = describeAlgebraDataCmd(aiCommand);
      if (!confirm(`El asistente quiere modificar tus datos.\n\n${summary}\n\n¿Aplicar?`)) {
        setChatMessages(prev => [
          ...prev,
          { id: createId(), role: 'assistant', text: 'Operación cancelada.' },
        ]);
        return;
      }
      setPendingAlgebraData({
        action: aiCommand.action,
        relation: aiCommand.relation,
        columns: aiCommand.columns,
        rows: aiCommand.rows,
        rowIndex: aiCommand.rowIndex,
        values: aiCommand.values,
        rowIndices: aiCommand.rowIndices,
        at: Date.now(),
      });
      if (canvasView !== 'algebra') setCanvasView('algebra');
      const msg = aiCommand.message?.trim() || 'Cambio aplicado a los datos.';
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: msg }]);
      return;
    }
    // Respuesta conversacional
    if (aiCommand?.type === 'chat') {
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: aiCommand.message }]);
      // Auto-learn from review findings: extract ERROR items as modeling rules
      const errorMatches = [...aiCommand.message.matchAll(/\[SEVERITY:\s*ERROR\][^:\n]*[:\-–—]+([^\n]+)/gi)];
      if (errorMatches.length > 0) {
        const newLessons = errorMatches
          .map(m => m[1].replace(/^[\s—–-]+/, '').trim())
          .filter(l => l.length > 10)
          .map(l => `Evitar: ${l.substring(0, 120)}`);
        if (newLessons.length > 0) {
          setModelingHints(prev => {
            const existing = new Set(prev);
            const added = newLessons.filter(l => !existing.has(l));
            return added.length > 0 ? [...prev, ...added] : prev;
          });
        }
      }
      return;
    }

    // Comandos nuevos (no legacy)
    if (aiCommand && !isLegacyAICommand(aiCommand.type)) {
      const cmd = aiCommand;
      // set-cardinality
      if (cmd.type === 'set-cardinality') {
        const eA = findEntityByLabel(cmd.entityA);
        const eB = findEntityByLabel(cmd.entityB);
        if (!eA || !eB) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré las entidades "${cmd.entityA}" y/o "${cmd.entityB}".` }]);
          return;
        }
        const relBetween = nodes.find(n => {
          if (n.type !== 'relationship') return false;
          const connA = connections.find(c => (c.sourceId === n.id && c.targetId === eA.id) || (c.sourceId === eA.id && c.targetId === n.id));
          const connB = connections.find(c => (c.sourceId === n.id && c.targetId === eB.id) || (c.sourceId === eB.id && c.targetId === n.id));
          return !!(connA && connB);
        });
        if (!relBetween) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré una relación entre "${cmd.entityA}" y "${cmd.entityB}". Creá primero la relación.` }]);
          return;
        }
        setConnections(prev => prev.map(c => {
          const isConnA = (c.sourceId === relBetween.id && c.targetId === eA.id) || (c.sourceId === eA.id && c.targetId === relBetween.id);
          const isConnB = (c.sourceId === relBetween.id && c.targetId === eB.id) || (c.sourceId === eB.id && c.targetId === relBetween.id);
          if (isConnA && cmd.cardinalityA) return { ...c, cardinality: cmd.cardinalityA };
          if (isConnB && cmd.cardinalityB) return { ...c, cardinality: cmd.cardinalityB };
          return c;
        }));
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Actualicé la cardinalidad de la relación entre ${eA.label} y ${eB.label}.` }]);
        return;
      }
      // set-participation
      if (cmd.type === 'set-participation') {
        const entity = findEntityByLabel(cmd.entityName);
        const rel = findRelationshipByLabel(cmd.relationshipName);
        if (!entity || !rel) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${cmd.entityName}" o la relación "${cmd.relationshipName}".` }]);
          return;
        }
        const conn = findConnectionBetween(entity.id, rel.id);
        if (!conn) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No hay conexión entre "${cmd.entityName}" y "${cmd.relationshipName}".` }]);
          return;
        }
        setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, isTotalParticipation: cmd.isTotal } : c));
        const label = cmd.isTotal ? 'total' : 'parcial';
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Participación de ${entity.label} en ${rel.label} marcada como ${label}.` }]);
        return;
      }
      // set-attribute-type
      if (cmd.type === 'set-attribute-type') {
        const entity = findEntityByLabel(cmd.entityName);
        if (!entity) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${cmd.entityName}".` }]);
          return;
        }
        const attr = findAttributeOfEntity(entity, cmd.attributeName);
        if (!attr) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré el atributo "${cmd.attributeName}" en ${entity.label}.` }]);
          return;
        }
        const attrUpdates: Partial<import('./types/er').AttributeNode> = {};
        if (cmd.isMultivalued !== undefined) attrUpdates.isMultivalued = cmd.isMultivalued;
        if (cmd.isDerived !== undefined) attrUpdates.isDerived = cmd.isDerived;
        if (cmd.isKey !== undefined) attrUpdates.isKey = cmd.isKey;
        updateNode(attr.id, attrUpdates);
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Actualicé el tipo del atributo ${attr.label} en ${entity.label}.` }]);
        return;
      }
      // set-connection-role
      if (cmd.type === 'set-connection-role') {
        const entity = findEntityByLabel(cmd.entityName);
        const rel = findRelationshipByLabel(cmd.relationshipName);
        if (!entity || !rel) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${cmd.entityName}" o la relación "${cmd.relationshipName}".` }]);
          return;
        }
        const conn = findConnectionBetween(entity.id, rel.id);
        if (!conn) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No hay conexión entre "${cmd.entityName}" y "${cmd.relationshipName}".` }]);
          return;
        }
        setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, role: cmd.role } : c));
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Rol de ${entity.label} en ${rel.label} establecido como "${cmd.role}".` }]);
        return;
      }
      // rename-relationship
      if (cmd.type === 'rename-relationship') {
        const rel = findRelationshipByLabel(cmd.relationshipName);
        if (!rel) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la relación "${cmd.relationshipName}".` }]);
          return;
        }
        updateNode(rel.id, { label: cmd.newName });
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Renombré la relación a "${cmd.newName}".` }]);
        return;
      }
      // delete-entity
      if (cmd.type === 'delete-entity') {
        const entity = findEntityByLabel(cmd.entityName);
        if (!entity) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${cmd.entityName}".` }]);
          return;
        }
        const attrIds = connections
          .filter(c => c.sourceId === entity.id || c.targetId === entity.id)
          .map(c => c.sourceId === entity.id ? c.targetId : c.sourceId)
          .filter(id => nodes.find(n => n.id === id)?.type === 'attribute');
        const toRemove = new Set([entity.id, ...attrIds]);
        setNodes(prev => prev.filter(n => !toRemove.has(n.id)));
        setConnections(prev => prev.filter(c => !toRemove.has(c.sourceId) && !toRemove.has(c.targetId)));
        setAggregations(prev =>
          prev
            .map(a => ({ ...a, memberIds: a.memberIds.filter(id => !toRemove.has(id)) }))
            .filter(a => a.memberIds.length >= 2)
        );
        setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(entity.id); return next; });
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Eliminé la entidad ${entity.label} y sus atributos.` }]);
        return;
      }
      // delete-relationship
      if (cmd.type === 'delete-relationship') {
        const rel = findRelationshipByLabel(cmd.relationshipName);
        if (!rel) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la relación "${cmd.relationshipName}".` }]);
          return;
        }
        setNodes(prev => prev.filter(n => n.id !== rel.id));
        setConnections(prev => prev.filter(c => c.sourceId !== rel.id && c.targetId !== rel.id));
        setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(rel.id); return next; });
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Eliminé la relación ${rel.label}.` }]);
        return;
      }
      // create-isa
      if (cmd.type === 'create-isa') {
        const superEntity = findEntityByLabel(cmd.supertype);
        if (!superEntity) {
          setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad supertipo "${cmd.supertype}". Creala primero.` }]);
          return;
        }
        const subtypeEntities: Array<{ id: string; label: string; position: { x: number; y: number } }> = [];
        const newNodes: ERNode[] = [];
        const newConnections: Connection[] = [];
        for (const subName of cmd.subtypes) {
          let sub = findEntityByLabel(subName);
          if (!sub) {
            const center = getCanvasCenter();
            const angle = (subtypeEntities.length / cmd.subtypes.length) * Math.PI;
            sub = {
              id: createId(), type: 'entity' as const, label: subName, isWeak: false,
              position: { x: center.x + Math.cos(angle) * 180, y: superEntity.position.y + 200 },
            };
            newNodes.push(sub);
          }
          subtypeEntities.push(sub);
        }
        const isaNode: import('./types/er').ISANode = {
          id: createId(), type: 'isa' as const,
          label: cmd.label ?? 'ES',
          position: { x: superEntity.position.x, y: superEntity.position.y + 100 },
          isDisjoint: cmd.isDisjoint,
          isTotal: cmd.isTotal,
        };
        newNodes.push(isaNode);
        newConnections.push({ id: createId(), sourceId: superEntity.id, targetId: isaNode.id, isTotalParticipation: false });
        for (const sub of subtypeEntities) {
          newConnections.push({ id: createId(), sourceId: isaNode.id, targetId: sub.id, isTotalParticipation: false });
        }
        setNodes(prev => [...prev, ...newNodes]);
        setConnections(prev => [...prev, ...newConnections]);
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Creé la jerarquía ISA: ${cmd.supertype} → ${cmd.subtypes.join(', ')}.` }]);
        return;
      }
    }

    // Comandos legacy: mapear AICommand → ParsedChatCommand
    if (aiCommand && isLegacyAICommand(aiCommand.type)) {
      const cmd = aiCommand;
      if (cmd.type === 'add-entity') {
        parsed = { type: 'add-entity', entityName: cmd.entityName, attributes: cmd.attributes, keyAttributes: cmd.keyAttributes, useDefaultAttributes: cmd.useDefaultAttributes };
      } else if (cmd.type === 'add-attributes') {
        parsed = { type: 'add-attributes', entityName: cmd.entityName, attributes: cmd.attributes, keyAttributes: cmd.keyAttributes };
      } else if (cmd.type === 'replace-attributes') {
        parsed = { type: 'replace-attributes', entityName: cmd.entityName, attributes: cmd.attributes, keyAttributes: cmd.keyAttributes };
      } else if (cmd.type === 'rename-entity') {
        parsed = { type: 'rename-entity', entityName: cmd.entityName, newName: cmd.newName };
      } else if (cmd.type === 'connect-entities') {
        parsed = {
          type: 'connect-entities', entityA: cmd.entityA, entityB: cmd.entityB, entityC: cmd.entityC,
          relationshipName: cmd.relationshipName,
          cardinalityA: cmd.cardinalityA, cardinalityB: cmd.cardinalityB, cardinalityC: cmd.cardinalityC,
          totalA: cmd.totalA, totalB: cmd.totalB, totalC: cmd.totalC,
          roleA: cmd.roleA, roleB: cmd.roleB, roleC: cmd.roleC,
        };
      } else if (cmd.type === 'connect-entity-aggregation') {
        parsed = { type: 'connect-entity-aggregation', entityName: cmd.entityName, aggregationEntityA: cmd.aggregationEntityA, aggregationEntityB: cmd.aggregationEntityB, relationshipName: cmd.relationshipName };
      } else if (cmd.type === 'set-entity-weakness') {
        parsed = { type: 'set-entity-weakness', entityName: cmd.entityName, isWeak: cmd.isWeak };
      } else if (cmd.type === 'clear-diagram') {
        parsed = { type: 'clear-diagram' };
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

    if (parsed.type === 'delete-entity') {
      const entity = findEntityByLabel(parsed.entityName);
      if (!entity) {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${parsed.entityName}".` }]);
        return;
      }
      const attrIds = connections
        .filter(c => c.sourceId === entity.id || c.targetId === entity.id)
        .map(c => c.sourceId === entity.id ? c.targetId : c.sourceId)
        .filter(id => nodes.find(n => n.id === id)?.type === 'attribute');
      const toRemove = new Set([entity.id, ...attrIds]);
      setNodes(prev => prev.filter(n => !toRemove.has(n.id)));
      setConnections(prev => prev.filter(c => !toRemove.has(c.sourceId) && !toRemove.has(c.targetId)));
      setAggregations(prev =>
        prev.map(a => ({ ...a, memberIds: a.memberIds.filter(id => !toRemove.has(id)) })).filter(a => a.memberIds.length >= 2)
      );
      setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(entity.id); return next; });
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Listo. Eliminé la entidad ${entity.label} y sus atributos.` }]);
      return;
    }

    if (parsed.type === 'replace-attributes') {
      const targetEntity = parsed.entityName === '__selected__'
        ? nodes.find(n => n.type === 'entity' && selectedNodeIds.has(n.id))
        : nodes.find(n => n.type === 'entity' && n.label.toLowerCase() === parsed.entityName.toLowerCase());
      if (!targetEntity) {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${parsed.entityName}".` }]);
        return;
      }
      const attrNodeIds = new Set(
        connections
          .filter(c => c.sourceId === targetEntity.id || c.targetId === targetEntity.id)
          .map(c => c.sourceId === targetEntity.id ? c.targetId : c.sourceId)
          .filter(id => nodes.find(n => n.id === id && n.type === 'attribute'))
      );
      const filteredNodes = nodes.filter(n => !attrNodeIds.has(n.id));
      const filteredConnections = connections.filter(c => !attrNodeIds.has(c.sourceId) && !attrNodeIds.has(c.targetId));
      const newAttrNodes: ERNode[] = [];
      const newConns: Connection[] = [];
      const keys = new Set(parsed.keyAttributes.map(k => k.toLowerCase()));
      const occupied = filteredNodes.map(n => ({ type: n.type, position: n.position }));
      const positions = placeAttributePositions(parsed.attributes, targetEntity.position, occupied);
      parsed.attributes.forEach((attr, i) => {
        const attrId = createId();
        newAttrNodes.push({
          id: attrId,
          type: 'attribute',
          position: positions[i] ?? { x: targetEntity.position.x + 100 + i * 20, y: targetEntity.position.y + 50 + i * 20 },
          label: attr,
          isKey: keys.has(attr.toLowerCase()),
          isMultivalued: false,
          isDerived: false,
        });
        newConns.push({ id: createId(), sourceId: targetEntity.id, targetId: attrId, isTotalParticipation: false });
      });
      setNodes([...filteredNodes, ...newAttrNodes]);
      setConnections([...filteredConnections, ...newConns]);
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Atributos de **${targetEntity.label}** reemplazados: ${parsed.attributes.join(', ')}.` }]);
      return;
    }

    if (parsed.type === 'rename-entity') {
      const targetEntity = parsed.entityName === '__selected__'
        ? nodes.find(n => n.type === 'entity' && selectedNodeIds.has(n.id))
        : nodes.find(n => n.type === 'entity' && n.label.toLowerCase() === parsed.entityName.toLowerCase());
      if (!targetEntity) {
        setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `No encontré la entidad "${parsed.entityName}".` }]);
        return;
      }
      setNodes(prev => prev.map(n => n.id === targetEntity.id ? { ...n, label: parsed.newName } : n));
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: `Entidad renombrada: **${targetEntity.label}** → **${parsed.newName}**.` }]);
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

      let rawAttributes = parsed.attributes;
      let rawKeyAttributes = parsed.keyAttributes;

      if ((parsed as { useDefaultAttributes?: boolean }).useDefaultAttributes || rawAttributes.length === 0) {
        setAiStatus('thinking');
        try {
          const aiResult = await inferAttributesWithAI(targetEntity.label);
          if (aiResult) {
            rawAttributes = aiResult.attributes;
            rawKeyAttributes = [aiResult.key];
          }
        } catch { /* ignore, fallback to empty */ } finally {
          setAiStatus('idle');
        }
      }

      const cleanedInput = cleanParsedAttributeInputs(rawAttributes);
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

      const { added, skipped } = addAttributesToExistingEntity(targetEntity, cleanedInput, rawKeyAttributes);
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
      detectAndSaveDomain();
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
      const entityC = parsed.entityC ? findEntityByLabel(parsed.entityC) : null;

      const missingNames = [
        !entityA ? parsed.entityA : null,
        !entityB ? parsed.entityB : null,
        entityC === null && parsed.entityC ? parsed.entityC : null,
      ].filter(Boolean);

      if (!entityA || !entityB || (parsed.entityC && !entityC)) {
        setChatMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            text: `No encontré las entidades: ${missingNames.join(', ')}. Verificá que existan en el diagrama.`
          }
        ]);
        return;
      }

      const isSelfRelationship = !entityC && entityA.id === entityB.id;
      const relId = createId();

      // Position: center of all participating entities
      const allEntities = entityC ? [entityA, entityB, entityC] : [entityA, entityB];
      const midX = isSelfRelationship
        ? entityA.position.x + 200
        : allEntities.reduce((s, e) => s + e.position.x, 0) / allEntities.length;
      const midY = isSelfRelationship
        ? entityA.position.y - 80
        : allEntities.reduce((s, e) => s + e.position.y, 0) / allEntities.length;

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
          cardinality: parsed.cardinalityA,
          isTotalParticipation: parsed.totalA ?? false,
          role: parsed.roleA,
        },
        {
          id: createId(),
          sourceId: relId,
          targetId: entityB.id,
          cardinality: parsed.cardinalityB,
          isTotalParticipation: parsed.totalB ?? false,
          role: parsed.roleB,
        },
      ];

      if (entityC) {
        newConnections.push({
          id: createId(),
          sourceId: entityC.id,
          targetId: relId,
          cardinality: parsed.cardinalityC,
          isTotalParticipation: parsed.totalC ?? false,
          role: parsed.roleC,
        });
      }

      setNodes(prev => [...prev, relationshipNode]);
      setConnections(prev => [...prev, ...newConnections]);
      setSelectedNodeIds(new Set([relId]));
      setSelectedConnectionIds(new Set());
      setSelectedAggregationIds(new Set());

      const entityNames = allEntities.map(e => e.label).join(', ');
      const relDesc = isSelfRelationship
        ? `Listo. Creé la autorrelación ${relationshipLabel} sobre ${entityA.label}.`
        : `Listo. Creé la relación${entityC ? ' ternaria' : ''} ${relationshipLabel} entre ${entityNames}.`;
      setChatMessages(prev => [...prev, { id: createId(), role: 'assistant', text: relDesc }]);
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
      {canvasView === 'er' && (
      <Toolbar
        items={(() => {
          const selectionCount = selectedNodeIds.size + selectedConnectionIds.size + selectedAggregationIds.size;
          const items: ToolbarItem[] = [
            {
              id: 'box-select',
              label: selectionMode ? 'Select ON' : 'Select',
              icon: '□',
              action: () => setSelectionMode(prev => !prev),
              active: selectionMode,
            },
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
            { id: 'add-textbox', label: 'Texto', icon: 'T', action: () => addNode('textbox') },
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
            // --- Explain ---
            ...(() => {
              const selectedRelationships = nodes.filter(n => selectedNodeIds.has(n.id) && n.type === 'relationship');
              if (selectedRelationships.length === 1) {
                return [{
                  id: 'explain-relationship',
                  label: 'Significado',
                  icon: '?',
                  action: () => explainRelationship(selectedRelationships[0].id),
                  separator: true,
                }];
              }
              return [];
            })(),
            // --- View & File ---
            { id: 'reset-view', label: 'Reset View', icon: '⟳', action: handleResetView, separator: true },
            { id: 'import', label: 'Import', icon: '📂', action: handleImportClick, separator: true },
            { id: 'export', label: 'Export', icon: '💾', action: handleExport },
            { id: 'restore', label: 'Restore', icon: '⏮', action: handleRestoreSnapshot, disabled: !hasSnapshot },
          ];
          return items;
        })()}
      />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={handleImportFile}
        style={{ display: 'none' }}
      />
      <main className="main-content">
        <div className="canvas-area" ref={canvasAreaRef}>
          <div className="canvas-view-tabs">
            <button
              className={`canvas-view-tab ${canvasView === 'er' ? 'active' : ''}`}
              onClick={() => setCanvasView('er')}
            >ER Diagram</button>
            <button
              className={`canvas-view-tab ${canvasView === 'schema' ? 'active' : ''}`}
              onClick={() => setCanvasView('schema')}
            >Esquema Relacional</button>
            <button
              className={`canvas-view-tab ${canvasView === 'sql' ? 'active' : ''}`}
              onClick={() => setCanvasView('sql')}
            >SQL DDL</button>
            <button
              className={`canvas-view-tab ${canvasView === 'algebra' ? 'active' : ''}`}
              onClick={() => setCanvasView('algebra')}
            >Álgebra</button>
            {selectedNodeIds.size > 0 && canvasView !== 'er' && (
              <span className="canvas-view-filter-badge">
                {selectedNodeIds.size} seleccionado{selectedNodeIds.size !== 1 ? 's' : ''}
              </span>
            )}
            <div className="canvas-export-btns">
              <button
                className="canvas-export-btn"
                onClick={() => handleExportImage('png')}
                disabled={isExporting}
                title="Exportar como PNG"
              >⬇ PNG</button>
              <button
                className="canvas-export-btn"
                onClick={() => handleExportImage('pdf')}
                disabled={isExporting}
                title="Exportar como PDF"
              >{isExporting ? '…' : '⬇ PDF'}</button>
            </div>
          </div>
          {canvasView === 'er' && (
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
                setActiveTab('properties');
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
          selectionMode={selectionMode}
          onBoxSelect={handleBoxSelect}
          onExplainRelationship={explainRelationship}
        />
          )}
          {canvasView === 'schema' && (
            <RelationalSchemaView
              schema={relationalSchema}
              selectedNodeIds={selectedNodeIds}
              onSelectNode={handleSelectNode}
              onNavigateToNode={handleNavigateToNode}
              onRenameNode={handleRenameNode}
            />
          )}
          {canvasView === 'sql' && (
            <SQLView
              sql={sqlDDL}
              tables={relationalSchema.tables}
              onNavigateToNode={handleNavigateToNode}
            />
          )}
          {canvasView === 'algebra' && (
            <AlgebraView
              tables={relationalSchema.tables}
              pendingQuery={pendingAlgebraQuery}
              onPendingQueryConsumed={() => setPendingAlgebraQuery(null)}
              pendingDataChange={pendingAlgebraData}
              onPendingDataConsumed={() => setPendingAlgebraData(null)}
              onApplyReverseEngineeredER={(reNodes, reConnections, notes) => {
                // Replace the ER diagram with the reverse-engineered one and
                // switch to the ER tab so the user sees the result. The
                // Relational-Schema and SQL tabs auto-derive from this.
                setNodes(reNodes);
                setConnections(reConnections);
                setAggregations([]);
                setSelectedNodeIds(new Set());
                setSelectedConnectionIds(new Set());
                setSelectedAggregationIds(new Set());
                setLastSelectedNodeId(null);
                setCanvasView('er');
                setChatMessages(prev => [
                  ...prev,
                  {
                    id: createId(),
                    role: 'assistant',
                    text: `Generé el diagrama ER desde tus relaciones importadas:\n\n${notes.map(n => `- ${n}`).join('\n')}\n\nRevisalo en el tab ER — puede que necesite ajustes de cardinalidad o nombres de relaciones.`,
                  },
                ]);
              }}
            />
          )}
        </div>
        {sidebarOpen && (
        <Splitter
          orientation="vertical"
          title="Arrastrar para cambiar el ancho del panel lateral"
          onDragStart={() => { sidebarDragBaseline.current = sidebarWidth; }}
          onDrag={(delta) => {
            // The splitter sits to the LEFT of the sidebar — moving right
            // (positive delta) shrinks the sidebar.
            const next = Math.max(220, Math.min(720, sidebarDragBaseline.current - delta));
            setSidebarWidth(next);
          }}
        />
        )}
        {sidebarOpen && (
        <aside className="sidebar" style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}>
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
                      {node.type === 'textbox' && (
                        <label>Texto: <textarea value={node.text || ''} onChange={e => updateNode(node.id, { text: e.target.value })} rows={4} style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-family)', fontSize: '12px' }} /></label>
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
            <div className="chat-mode-bar" title="El chat usa contexto y prompt específicos según la pestaña activa">
              <span className="chat-mode-label">Modo:</span>
              <span className={`chat-mode-chip mode-${canvasView}`}>
                {canvasView === 'er' && 'Diagrama ER'}
                {canvasView === 'schema' && 'Esquema Relacional'}
                {canvasView === 'sql' && 'SQL DDL'}
                {canvasView === 'algebra' && 'Álgebra Relacional'}
              </span>
            </div>
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
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                </div>
              ))}
            </div>
            {(aiStatus === 'thinking' || batchProgress !== null) && (
              <div className="ai-thinking-bar">
                <span className="ai-thinking-spinner" />
                {batchProgress !== null
                  ? <span className="ai-thinking-label">Aplicando {batchProgress.current}/{batchProgress.total}…</span>
                  : <span className="ai-thinking-label">Procesando… {formatThinkingTime(aiThinkingSeconds)}</span>
                }
              </div>
            )}
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
              <div className="chat-input-actions">
                <button onClick={handleChatSubmit} className="primary-button">Enviar</button>
                {chatMessages.length > 0 && (
                  <button onClick={() => setChatMessages([])} className="chat-clear-btn" title="Limpiar chat">✕</button>
                )}
              </div>
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
                    if (provider === 'openai') {
                      setAiModel('gpt-5.4');
                    } else if (provider === 'gemini') {
                      const preferred = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
                      setAiModel(preferred.find(model => geminiModels.includes(model)) ?? geminiModels[0] ?? 'gemini-2.5-pro');
                    } else if (provider === 'grok') {
                      const preferred = ['grok-4-fast', 'grok-3-mini', 'grok-2-latest'];
                      setAiModel(preferred.find(model => grokModels.includes(model)) ?? grokModels[0] ?? 'grok-3-mini');
                    } else if (provider === 'openclaw') {
                      setAiModel(openclawModels[0] || 'openclaw/main');
                    } else {
                      setAiModel(ollamaModels[0] || 'gemma3');
                    }
                  }}
                  disabled={!aiEnabled}
                >
                  <option value="openai">ChatGPT (OAuth)</option>
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
