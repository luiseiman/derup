import React, { useState, useRef, useEffect } from 'react';
import type { WheelEvent } from 'react';
import './Canvas.css';
import type { ERNode, Connection, Aggregation } from '../../types/er';
import { NodeDispatcher } from '../Shapes/NodeDispatcher';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { useContextMenu, type MenuItem } from '../../hooks/useContextMenu';

interface CanvasProps {
    nodes: ERNode[];
    aggregations: Aggregation[];
    selectedAggregationIds: Set<string>;
    connections: Connection[];
    scale: number;
    offset: { x: number, y: number };
    onNodesChange: (nodes: ERNode[]) => void;
    onConnectionsChange: (connections: Connection[]) => void;
    onViewChange: (scale?: number, offset?: { x: number, y: number }) => void;
    onNodeClick: (id: string, multi: boolean) => void;
    onAggregationClick: (id: string, multi: boolean) => void;
    onConnectionClick: (id: string, multi: boolean) => void;
    onCanvasClick: () => void;
    multiSelectMode: boolean;
}

const Canvas: React.FC<CanvasProps> = ({
    nodes,
    aggregations,
    selectedAggregationIds,
    connections,
    scale,
    offset,
    onNodesChange,
    onConnectionsChange,
    onViewChange,
    onNodeClick,
    onAggregationClick,
    onConnectionClick,
    onCanvasClick,
    multiSelectMode
}) => {
    const [isPanning, setIsPanning] = useState(false);
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [draggedAggregationId, setDraggedAggregationId] = useState<string | null>(null);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
    const [isDrag, setIsDrag] = useState(false); // Distinction between click and drag

    const canvasRef = useRef<HTMLDivElement>(null);
    const contextMenu = useContextMenu();

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            const zoomSensitivity = 0.001;
            const newScale = scale - e.deltaY * zoomSensitivity;
            const clampedScale = Math.min(Math.max(0.1, newScale), 5);
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
                const cursorX = e.clientX - rect.left;
                const cursorY = e.clientY - rect.top;
                const worldX = (cursorX - offset.x) / scale;
                const worldY = (cursorY - offset.y) / scale;
                const newOffset = {
                    x: cursorX - worldX * clampedScale,
                    y: cursorY - worldY * clampedScale,
                };
                onViewChange(clampedScale, newOffset);
            } else {
                onViewChange(clampedScale, undefined);
            }
        } else {
            const newOffset = { x: offset.x - e.deltaX, y: offset.y - e.deltaY };
            onViewChange(undefined, newOffset);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        // If clicking on SVG line (handled by line click), stop propagation there?
        // Actually line click is usually handled by onClick.
        // We only want to start panning if clicking on background.
        if (e.button === 1 || (e.button === 0 && !draggedNodeId && !draggedAggregationId)) {
            setIsPanning(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
            setIsDrag(false);
        }
    };

    const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        setDraggedNodeId(nodeId);
        setDraggedAggregationId(null);
        setLastMousePos({ x: e.clientX, y: e.clientY });
        setIsDrag(false);
    };

    const handleAggregationMouseDown = (e: React.MouseEvent, aggregationId: string) => {
        e.stopPropagation();
        setDraggedAggregationId(aggregationId);
        setDraggedNodeId(null);
        setLastMousePos({ x: e.clientX, y: e.clientY });
        setIsDrag(false);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setIsDrag(true);
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            onViewChange(undefined, { x: offset.x + dx, y: offset.y + dy });
            setLastMousePos({ x: e.clientX, y: e.clientY });
        } else if (draggedNodeId) {
            setIsDrag(true);
            const dx = (e.clientX - lastMousePos.x) / scale;
            const dy = (e.clientY - lastMousePos.y) / scale;

            const draggedNode = nodes.find(node => node.id === draggedNodeId) ?? null;
            const shouldMoveAttached = draggedNode?.type === 'entity' || draggedNode?.type === 'relationship';
            const attachedAttributeIds = shouldMoveAttached
                ? new Set(
                    connections
                        .filter(conn => conn.sourceId === draggedNodeId || conn.targetId === draggedNodeId)
                        .map(conn => (conn.sourceId === draggedNodeId ? conn.targetId : conn.sourceId))
                        .filter(id => nodes.find(node => node.id === id)?.type === 'attribute')
                )
                : new Set<string>();

            const updatedNodes = nodes.map(node => {
                if (node.id === draggedNodeId || attachedAttributeIds.has(node.id)) {
                    return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
                }
                return node;
            });
            onNodesChange(updatedNodes);

            setLastMousePos({ x: e.clientX, y: e.clientY });
        } else if (draggedAggregationId) {
            setIsDrag(true);
            const dx = (e.clientX - lastMousePos.x) / scale;
            const dy = (e.clientY - lastMousePos.y) / scale;

            const aggregation = aggregations.find(agg => agg.id === draggedAggregationId);
            if (!aggregation) return;
            const memberIds = new Set(aggregation.memberIds);

            const updatedNodes = nodes.map(node => {
                if (memberIds.has(node.id)) {
                    return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
                }
                return node;
            });
            onNodesChange(updatedNodes);

            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (!isDrag) {
            // It was a click
            if (draggedNodeId) {
                // Clicked on node
                onNodeClick(draggedNodeId, multiSelectMode || e.shiftKey || e.metaKey || e.ctrlKey);
            } else if (draggedAggregationId) {
                onAggregationClick(draggedAggregationId, multiSelectMode || e.shiftKey || e.metaKey || e.ctrlKey);
            } else {
                // Check if we hit a connection? The connection onClick should have fired if so?
                // SVG events bubble.
                // We will rely on bubbling to NOT hit this if connection handled it.
                // Actually we need to stop prop on connection click.
                onCanvasClick();
            }
        }

        setIsPanning(false);
        setDraggedNodeId(null);
        setDraggedAggregationId(null);
        setIsDrag(false);
    };

    // Prevent default browser zoom
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const preventDefault = (e: globalThis.WheelEvent) => {
            if (e.ctrlKey || e.metaKey) e.preventDefault();
        };
        canvas.addEventListener('wheel', preventDefault, { passive: false });
        // Clean up
        return () => canvas.removeEventListener('wheel', preventDefault);
    }, []);

    const nodesById = new Map(nodes.map(node => [node.id, node]));

    const getNodeSize = (node: ERNode) => {
        switch (node.type) {
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

    type AggregationBounds = {
        x: number;
        y: number;
        width: number;
        height: number;
        cx: number;
        cy: number;
    };

    const aggregationBounds = new Map<string, AggregationBounds>();
    aggregations.forEach(agg => {
        const members = agg.memberIds
            .map(id => nodesById.get(id))
            .filter((node): node is ERNode => Boolean(node));
        if (members.length === 0) return;

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        members.forEach(member => {
            const size = getNodeSize(member);
            const left = member.position.x - size.width / 2;
            const right = member.position.x + size.width / 2;
            const top = member.position.y - size.height / 2;
            const bottom = member.position.y + size.height / 2;

            if (left < minX) minX = left;
            if (right > maxX) maxX = right;
            if (top < minY) minY = top;
            if (bottom > maxY) maxY = bottom;
        });

        const padding = typeof agg.padding === 'number' ? agg.padding : 16;
        const x = minX - padding;
        const y = minY - padding;
        const width = (maxX - minX) + padding * 2;
        const height = (maxY - minY) + padding * 2;

        aggregationBounds.set(agg.id, {
            x,
            y,
            width,
            height,
            cx: x + width / 2,
            cy: y + height / 2
        });
    });

    const getBoundaryPoint = (node: ERNode, ux: number, uy: number) => {
        const ax = Math.abs(ux);
        const ay = Math.abs(uy);

        switch (node.type) {
            case 'entity': {
                const halfW = 50;
                const halfH = 25;
                const t = ax === 0 ? (halfH / ay) : ay === 0 ? (halfW / ax) : Math.min(halfW / ax, halfH / ay);
                return { x: node.position.x + ux * t, y: node.position.y + uy * t };
            }
            case 'relationship': {
                const halfW = 50;
                const halfH = 30;
                const t = 1 / ((ax / halfW) + (ay / halfH));
                return { x: node.position.x + ux * t, y: node.position.y + uy * t };
            }
            case 'attribute': {
                const rx = 40;
                const ry = 20;
                const t = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
                return { x: node.position.x + ux * t, y: node.position.y + uy * t };
            }
            case 'isa':
            default: {
                const halfW = 35;
                const halfH = 30;
                const t = ax === 0 ? (halfH / ay) : ay === 0 ? (halfW / ax) : Math.min(halfW / ax, halfH / ay);
                return { x: node.position.x + ux * t, y: node.position.y + uy * t };
            }
        }
    };

    const getAggregationBoundaryPoint = (bounds: AggregationBounds, ux: number, uy: number) => {
        const ax = Math.abs(ux);
        const ay = Math.abs(uy);
        const halfW = bounds.width / 2;
        const halfH = bounds.height / 2;
        const t = ax === 0 ? (halfH / ay) : ay === 0 ? (halfW / ax) : Math.min(halfW / ax, halfH / ay);
        return { x: bounds.cx + ux * t, y: bounds.cy + uy * t };
    };

    const getEndpoints = (sourceId: string, targetId: string) => {
        const sourceNode = nodesById.get(sourceId);
        const targetNode = nodesById.get(targetId);
        const sourceAggBounds = aggregationBounds.get(sourceId);
        const targetAggBounds = aggregationBounds.get(targetId);

        const sourceCenter = sourceNode
            ? sourceNode.position
            : sourceAggBounds
                ? { x: sourceAggBounds.cx, y: sourceAggBounds.cy }
                : null;
        const targetCenter = targetNode
            ? targetNode.position
            : targetAggBounds
                ? { x: targetAggBounds.cx, y: targetAggBounds.cy }
                : null;

        if (!sourceCenter || !targetCenter) return null;

        const dx = targetCenter.x - sourceCenter.x;
        const dy = targetCenter.y - sourceCenter.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        const start = sourceNode
            ? getBoundaryPoint(sourceNode, ux, uy)
            : sourceAggBounds
                ? getAggregationBoundaryPoint(sourceAggBounds, ux, uy)
                : null;

        const end = targetNode
            ? getBoundaryPoint(targetNode, -ux, -uy)
            : targetAggBounds
                ? getAggregationBoundaryPoint(targetAggBounds, -ux, -uy)
                : null;

        if (!start || !end) return null;

        return { start, end };
    };

    const renderAggregations = () => {
        return aggregations.map(agg => {
            const bounds = aggregationBounds.get(agg.id);
            if (!bounds) return null;
            const isSelected = selectedAggregationIds.has(agg.id);

            return (
                <g
                    key={agg.id}
                    style={{ cursor: 'grab' }}
                >
                    {/* Wide transparent stroke for easier touch selection */}
                    <rect
                        x={bounds.x}
                        y={bounds.y}
                        width={bounds.width}
                        height={bounds.height}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                        pointerEvents="stroke"
                        onMouseDown={(e) => handleAggregationMouseDown(e, agg.id)}
                    />
                    {/* Visible dashed border */}
                    <rect
                        x={bounds.x}
                        y={bounds.y}
                        width={bounds.width}
                        height={bounds.height}
                        fill="none"
                        stroke={isSelected ? "blue" : "#666"}
                        strokeWidth={isSelected ? 2 : 1.5}
                        strokeDasharray="6 4"
                        pointerEvents="stroke"
                    />
                    {agg.label && (
                        <text
                            x={bounds.x + 6}
                            y={bounds.y - 6}
                            fill={isSelected ? "blue" : "#666"}
                            fontSize="12"
                        >
                            {agg.label}
                        </text>
                    )}
                </g>
            );
        });
    };

    const renderConnections = () => {
        // Build a map to detect duplicate connections between same node pairs
        const pairKey = (a: string, b: string) => [a, b].sort().join('::');
        const pairCounts: Record<string, number> = {};
        const pairIndex: Record<string, number> = {};
        connections.forEach(conn => {
            const key = pairKey(conn.sourceId, conn.targetId);
            pairCounts[key] = (pairCounts[key] || 0) + 1;
        });

        return connections.map(conn => {
            const sourceNode = nodesById.get(conn.sourceId) ?? null;
            const targetNode = nodesById.get(conn.targetId) ?? null;
            const sourceAgg = aggregationBounds.get(conn.sourceId) ?? null;
            const targetAgg = aggregationBounds.get(conn.targetId) ?? null;
            if (!sourceNode && !sourceAgg) return null;
            if (!targetNode && !targetAgg) return null;

            const isSelected = (conn as Connection & { selected?: boolean }).selected;
            const key = pairKey(conn.sourceId, conn.targetId);
            const isDuplicate = pairCounts[key] > 1;

            // Track which index this connection is within its pair
            if (pairIndex[key] === undefined) pairIndex[key] = 0;
            const myIndex = pairIndex[key]++;

            // Determine Arrow Direction for Key Constraint ('1')
            let markerStart = undefined;
            let markerEnd = undefined;

            if (conn.cardinality === '1') {
                const sourceRole = sourceNode?.type === 'relationship'
                    ? 'relationship'
                    : sourceNode?.type === 'entity'
                        ? 'entity'
                        : sourceAgg
                            ? 'entity'
                            : 'other';
                const targetRole = targetNode?.type === 'relationship'
                    ? 'relationship'
                    : targetNode?.type === 'entity'
                        ? 'entity'
                        : targetAgg
                            ? 'entity'
                            : 'other';

                // Use curve-specific markers for duplicate connections
                const prefix = isDuplicate ? 'arrow-curve' : 'arrow-head';
                if (sourceRole === 'relationship' && targetRole === 'entity') {
                    markerStart = isSelected ? `url(#${prefix}-blue)` : `url(#${prefix})`;
                } else if (sourceRole === 'entity' && targetRole === 'relationship') {
                    markerEnd = isSelected ? `url(#${prefix}-blue)` : `url(#${prefix})`;
                }
            }

            const endpoints = getEndpoints(conn.sourceId, conn.targetId);
            if (!endpoints) return null;
            const { start, end } = endpoints;

            const sx = start.x;
            const sy = start.y;
            const tx = end.x;
            const ty = end.y;

            if (isDuplicate) {
                // Curved rendering for reflexive/duplicate connections
                const mx = (sx + tx) / 2;
                const my = (sy + ty) / 2;
                const dx = tx - sx;
                const dy = ty - sy;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                // Perpendicular unit vector
                const px = -dy / len;
                const py = dx / len;
                // Offset: first connection curves one way, second curves the other
                const curveOffset = 50;
                const direction = myIndex === 0 ? 1 : -1;
                const cx = mx + px * curveOffset * direction;
                const cy = my + py * curveOffset * direction;

                // Midpoint of the curve (approximate: the control point area)
                const curveMidX = (sx + 2 * cx + tx) / 4;
                const curveMidY = (sy + 2 * cy + ty) / 4;

                const pathD = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;

                return (
                    <g key={conn.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            onConnectionClick(conn.id, multiSelectMode || e.shiftKey || e.metaKey || e.ctrlKey);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onConnectionClick(conn.id, false);
                            const items = getConnectionContextMenuItems(conn.id);
                            contextMenu.show(e.clientX, e.clientY, items, 'connection', conn.id);
                        }}
                        style={{ cursor: 'pointer' }}
                    >
                        {/* Invisible thick path for hit testing */}
                        <path d={pathD} stroke="transparent" strokeWidth={10} fill="none" />
                        {/* Visible curved path */}
                        <path
                            d={pathD}
                            stroke={isSelected ? "var(--accent)" : "#0f172a"}
                            strokeWidth={conn.isTotalParticipation ? 4 : 2}
                            fill="none"
                            markerStart={markerStart}
                            markerEnd={markerEnd}
                        />
                        {/* Cardinality Label */}
                        {conn.cardinality && (
                        <text
                            x={curveMidX}
                            y={curveMidY - 10}
                            textAnchor="middle"
                            fill="#0f172a"
                            fontSize="12"
                        >
                            {conn.cardinality}
                        </text>
                        )}
                        {/* Role Label */}
                        {conn.role && (
                        <text
                            x={curveMidX}
                            y={curveMidY + 15}
                            textAnchor="middle"
                            fill="#64748b"
                            fontSize="11"
                            fontStyle="italic"
                        >
                            {conn.role}
                        </text>
                        )}
                    </g>
                );
            }

            // Standard straight-line rendering
            return (
                <g key={conn.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        onConnectionClick(conn.id, multiSelectMode || e.shiftKey || e.metaKey || e.ctrlKey);
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onConnectionClick(conn.id, false);
                        const items = getConnectionContextMenuItems(conn.id);
                        contextMenu.show(e.clientX, e.clientY, items, 'connection', conn.id);
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    {/* Invisible thick line for hit testing */}
                    <line
                        x1={sx} y1={sy}
                        x2={tx} y2={ty}
                        stroke="transparent"
                        strokeWidth={10}
                    />
                    {/* Visible line */}
                    <line
                        x1={sx} y1={sy}
                        x2={tx} y2={ty}
                        stroke={isSelected ? "var(--accent)" : "#0f172a"}
                        strokeWidth={conn.isTotalParticipation ? 4 : 2}
                        markerStart={markerStart}
                        markerEnd={markerEnd}
                    />
                    {/* Cardinality Label */}
                    {conn.cardinality && (
                        <text
                            x={(sx + tx) / 2}
                            y={(sy + ty) / 2 - 10}
                            textAnchor="middle"
                            fill="#0f172a"
                            fontSize="12"
                        >
                            {conn.cardinality}
                        </text>
                    )}
                    {/* Role Label */}
                    {conn.role && (
                        <text
                            x={(sx + tx) / 2}
                            y={(sy + ty) / 2 + 15}
                            textAnchor="middle"
                            fill="#64748b"
                            fontSize="11"
                            fontStyle="italic"
                        >
                            {conn.role}
                        </text>
                    )}
                </g>
            );
        });
    };

    /**
     * Helper: Validate if a connection is allowed between two node types
     * ER Model Rules:
     * - Entity ↔ Relationship: Allowed
     * - Entity ↔ Attribute: Allowed
     * - Relationship ↔ Attribute: Allowed
     * - Entity ↔ ISA: Allowed (for specialization)
     * - Entity ↔ Entity: NOT allowed (must use Relationship)
     * - Relationship ↔ Relationship: NOT allowed
     * - Attribute ↔ Attribute: NOT allowed
     * - Others: NOT allowed
     */
    const isValidConnection = (sourceId: string, targetId: string): boolean => {
        const sourceNode = nodes.find(n => n.id === sourceId);
        const targetNode = nodes.find(n => n.id === targetId);
        
        if (!sourceNode || !targetNode) return false;
        
        const sourceType = sourceNode.type;
        const targetType = targetNode.type;
        
        // Cannot connect same type
        if (sourceType === targetType) return false;
        
        // Valid combinations
        const validPairs = new Set([
            'entity-relationship',
            'relationship-entity',
            'entity-attribute',
            'attribute-entity',
            'relationship-attribute',
            'attribute-relationship',
            'entity-isa',
            'isa-entity',
        ]);
        
        const pair = `${sourceType}-${targetType}`;
        return validPairs.has(pair);
    };

    /**
     * Helper: Create a connection between two nodes
     */
    const createConnection = (sourceId: string, targetId: string) => {
        // Validate connection type
        if (!isValidConnection(sourceId, targetId)) {
            console.warn(`Cannot connect ${nodes.find(n => n.id === sourceId)?.type} with ${nodes.find(n => n.id === targetId)?.type}`);
            return;
        }

        // Check if connection already exists
        const exists = connections.some(
            c => (c.sourceId === sourceId && c.targetId === targetId) ||
                 (c.sourceId === targetId && c.targetId === sourceId)
        );
        if (exists) return;

        const newConn: Connection = {
            id: Math.random().toString(36).slice(2),
            sourceId,
            targetId,
            cardinality: 'N',
            isTotalParticipation: false,
        };
        onConnectionsChange([...connections, newConn]);
    };

    /**
     * Generate context menu items for a node
     */
    const getNodeContextMenuItems = (nodeId: string): MenuItem[] => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return [];

        const items: MenuItem[] = [
            {
                id: 'edit-label',
                label: '✏️ Edit Label',
                action: () => {
                    // This will be handled by focusing the properties panel
                    // For now, we'll just select the node
                    onNodeClick(nodeId, false);
                },
            },
        ];

        // Add connect options with other selected nodes (only valid connections)
        const otherSelectedNodes = nodes.filter(
            n => n.selected && n.id !== nodeId && isValidConnection(nodeId, n.id)
        );
        if (otherSelectedNodes.length > 0) {
            items.push({ id: 'divider-connect', label: '', divider: true });
            otherSelectedNodes.forEach(selectedNode => {
                items.push({
                    id: `connect-${selectedNode.id}`,
                    label: `🔗 Connect with ${selectedNode.label}`,
                    action: () => {
                        createConnection(nodeId, selectedNode.id);
                    },
                });
            });
        }

        // Add option to connect with any node (only valid connections)
        const otherNodes = nodes.filter(
            n => n.id !== nodeId && !n.selected && isValidConnection(nodeId, n.id)
        );
        if (otherNodes.length > 0) {
            if (otherSelectedNodes.length === 0) {
                items.push({ id: 'divider-connect', label: '', divider: true });
            }
            items.push({
                id: 'connect-submenu',
                label: '🔗 Connect with...',
                action: undefined, // This is just a placeholder; real submenu functionality can be added
            });
            otherNodes.forEach(otherNode => {
                items.push({
                    id: `connect-any-${otherNode.id}`,
                    label: `    • ${otherNode.label}`,
                    action: () => {
                        createConnection(nodeId, otherNode.id);
                    },
                });
            });
        }

        // Add type-specific options
        if (node.type === 'entity' || node.type === 'relationship') {
            items.push({
                id: 'add-attribute',
                label: '➕ Add Attribute',
                action: () => {
                    // Creating a new attribute node
                    const newAttrNode: ERNode = {
                        id: Math.random().toString(36).slice(2),
                        type: 'attribute',
                        label: 'New Attribute',
                        position: {
                            x: node.position.x + 80,
                            y: node.position.y + 80,
                        },
                        selected: false,
                        isKey: false,
                        isMultivalued: false,
                        isDerived: false,
                    };
                    const newConn: Connection = {
                        id: Math.random().toString(36).slice(2),
                        sourceId: nodeId,
                        targetId: newAttrNode.id,
                        cardinality: 'N',
                        isTotalParticipation: false,
                    };
                    onNodesChange([...nodes, newAttrNode]);
                    setTimeout(
                        () => onConnectionsChange([...connections, newConn]),
                        0
                    );
                },
            });
        }

        items.push(
            { id: 'divider-1', label: '', divider: true },
            {
                id: 'duplicate',
                label: '📋 Duplicate',
                action: () => {
                    const newNode: ERNode = {
                        ...node,
                        id: Math.random().toString(36).slice(2),
                        position: {
                            x: node.position.x + 40,
                            y: node.position.y + 40,
                        },
                        selected: false,
                    };
                    onNodesChange([...nodes, newNode]);
                },
            },
            { id: 'divider-2', label: '', divider: true },
            {
                id: 'delete',
                label: '🗑️ Delete',
                action: () => {
                    onNodeClick(nodeId, false);
                    // Simulate delete button click - the app's delete logic will handle it
                    // We'll filter out the node here
                    const filtered = nodes.filter(n => n.id !== nodeId);
                    // Also remove connected connections
                    const filteredConns = connections.filter(
                        c => c.sourceId !== nodeId && c.targetId !== nodeId
                    );
                    onNodesChange(filtered);
                    onConnectionsChange(filteredConns);
                },
            }
        );

        return items;
    };

    /**
     * Generate context menu items for a connection
     */
    const getConnectionContextMenuItems = (connectionId: string): MenuItem[] => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return [];

        const items: MenuItem[] = [
            {
                id: 'toggle-participation',
                label: `${conn.isTotalParticipation ? '○' : '●'} Total Participation`,
                action: () => {
                    const updated = connections.map(c =>
                        c.id === connectionId
                            ? { ...c, isTotalParticipation: !c.isTotalParticipation }
                            : c
                    );
                    onConnectionsChange(updated);
                },
            },
            {
                id: 'set-cardinality',
                label: '⊕ Cardinality',
                action: () => {
                    // For now, we'll cycle through cardinalities
                    const cardinalityMap: Record<string, 'N' | '1' | 'M'> = { 
                        'N': '1', 
                        '1': 'M', 
                        'M': 'N' 
                    };
                    const currentCard = String(conn.cardinality) as keyof typeof cardinalityMap;
                    const next = cardinalityMap[currentCard] || '1';
                    const updated = connections.map(c =>
                        c.id === connectionId ? { ...c, cardinality: next } : c
                    );
                    onConnectionsChange(updated);
                },
            },
            { id: 'divider-delete', label: '', divider: true },
            {
                id: 'delete',
                label: '🗑️ Delete Connection',
                action: () => {
                    const filtered = connections.filter(c => c.id !== connectionId);
                    onConnectionsChange(filtered);
                },
            },
        ];

        return items;
    };

    /**
     * Generate context menu items for canvas background
     */
    const getCanvasContextMenuItems = (): MenuItem[] => {
        return [
            {
                id: 'new-entity',
                label: '◻️ New Entity',
                action: () => {
                    const newNode: ERNode = {
                        id: Math.random().toString(36).slice(2),
                        type: 'entity',
                        label: 'Entity',
                        position: { x: 300, y: 300 },
                        selected: false,
                        isWeak: false,
                    };
                    onNodesChange([...nodes, newNode]);
                },
            },
            {
                id: 'new-relationship',
                label: '◇ New Relationship',
                action: () => {
                    const newNode: ERNode = {
                        id: Math.random().toString(36).slice(2),
                        type: 'relationship',
                        label: 'Relationship',
                        position: { x: 300, y: 300 },
                        selected: false,
                        isIdentifying: false,
                    };
                    onNodesChange([...nodes, newNode]);
                },
            },
            {
                id: 'new-isa',
                label: '△ New ISA',
                action: () => {
                    const newNode: ERNode = {
                        id: Math.random().toString(36).slice(2),
                        type: 'isa',
                        label: 'ISA',
                        position: { x: 300, y: 300 },
                        selected: false,
                        isDisjoint: false,
                        isTotal: false,
                    };
                    onNodesChange([...nodes, newNode]);
                },
            },
        ];
    };

    /**
     * Handle context menu on node (right-click or long-press)
     */
    const handleNodeContextMenu = (e: React.MouseEvent, nodeId: string) => {
        e.preventDefault();
        e.stopPropagation();
        onNodeClick(nodeId, false);
        const items = getNodeContextMenuItems(nodeId);
        contextMenu.show(e.clientX, e.clientY, items, 'node', nodeId);
    };

    /**
     * Handle touch start on node for long-press
     */
    const handleNodeTouchStart = (e: React.TouchEvent, nodeId: string) => {
        const items = getNodeContextMenuItems(nodeId);
        contextMenu.handleTouchStart(
            e,
            items,
            'node',
            nodeId
        );
    };

    /**
     * Handle context menu on canvas
     */
    const handleCanvasContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const items = getCanvasContextMenuItems();
        contextMenu.show(e.clientX, e.clientY, items, 'canvas');
    };

    const transformStyle = {
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        transformOrigin: '0 0'
    };

    return (
        <div
            className="canvas-wrapper"
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setIsPanning(false); setDraggedNodeId(null); setDraggedAggregationId(null); setIsDrag(false); }}
            onWheel={handleWheel}
            onContextMenu={handleCanvasContextMenu}
        >
            <div className="canvas-content" style={transformStyle}>
                <svg
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '1px',
                        height: '1px',
                        overflow: 'visible',
                        pointerEvents: 'none', // Let clicks pass through empty space
                        zIndex: 0
                    }}
                >
                    <defs>
                        {/* Markers for straight lines */}
                        <marker
                            id="arrow-head"
                            markerWidth="16"
                            markerHeight="10"
                            refX="16"
                            refY="5"
                            orient="auto-start-reverse"
                            markerUnits="userSpaceOnUse"
                        >
                            <polygon points="0 0, 16 5, 0 10" fill="#0f172a" />
                        </marker>
                        <marker
                            id="arrow-head-blue"
                            markerWidth="16"
                            markerHeight="10"
                            refX="16"
                            refY="5"
                            orient="auto-start-reverse"
                            markerUnits="userSpaceOnUse"
                        >
                            <polygon points="0 0, 16 5, 0 10" fill="#0f766e" />
                        </marker>
                        {/* Markers for curved paths */}
                        <marker
                            id="arrow-curve"
                            markerWidth="16"
                            markerHeight="10"
                            refX="16"
                            refY="5"
                            orient="auto-start-reverse"
                            markerUnits="userSpaceOnUse"
                        >
                            <polygon points="0 0, 16 5, 0 10" fill="#0f172a" />
                        </marker>
                        <marker
                            id="arrow-curve-blue"
                            markerWidth="16"
                            markerHeight="10"
                            refX="16"
                            refY="5"
                            orient="auto-start-reverse"
                            markerUnits="userSpaceOnUse"
                        >
                            <polygon points="0 0, 16 5, 0 10" fill="#0f766e" />
                        </marker>
                    </defs>
                    <g style={{ pointerEvents: 'visiblePainted' }}>
                        {renderAggregations()}
                        {renderConnections()}
                    </g>
                </svg>

                {nodes.map(node => (
                    <NodeDispatcher
                        key={node.id}
                        node={node}
                        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                        onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                        onTouchStart={(e) => handleNodeTouchStart(e, node.id)}
                        onTouchEnd={contextMenu.handleTouchEnd}
                        onTouchMove={contextMenu.handleTouchMove}
                    />
                ))}
            </div>

            <ContextMenu
                state={contextMenu.state}
                onClose={contextMenu.hide}
                onAction={contextMenu.executeAction}
            />

            <div className="canvas-controls">
                Zoom: {(scale * 100).toFixed(0)}%
            </div>
        </div>
    );
};

export default Canvas;
