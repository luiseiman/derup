import React, { memo } from 'react';
import type { RelationshipNode } from '../../types/er';

interface RelationshipProps {
    node: RelationshipNode;
    selected: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
}

export const RelationshipShape: React.FC<RelationshipProps> = memo(({ node, selected, onMouseDown }) => {
    const isIdentifying = node.isIdentifying;

    // Dimensions
    const width = 100;
    const height = 60; // Diamond usually a bit wider?

    // Diamond points
    const midX = width / 2;
    const midY = height / 2;
    const p1 = `${midX},0`;
    const p2 = `${width},${midY}`;
    const p3 = `${midX},${height}`;
    const p4 = `0,${midY}`;
    const points = `${p1} ${p2} ${p3} ${p4}`;

    // Inner Diamond points for identifying relationship
    const offset = 5;
    const ip1 = `${midX},${offset * 1.5}`; // rough application of offset geometry
    const ip2 = `${width - offset * 1.5},${midY}`;
    const ip3 = `${midX},${height - offset * 1.5}`;
    const ip4 = `${offset * 1.5},${midY}`;
    const innerPoints = `${ip1} ${ip2} ${ip3} ${ip4}`;

    return (
        <div
            style={{
                width, height, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab',
                filter: selected ? 'drop-shadow(0 0 6px #9333ea) drop-shadow(0 0 14px rgba(147,51,234,0.45))' : undefined,
                zIndex: selected ? 10 : undefined,
            }}
            onMouseDown={onMouseDown}
        >
            <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                <polygon
                    points={points}
                    fill={selected ? "#f3e8ff" : "white"}
                    stroke={selected ? "var(--accent)" : "#0f172a"}
                    strokeWidth={selected ? 3.5 : 1}
                />
                {isIdentifying && (
                    <polygon
                        points={innerPoints}
                        fill="none"
                        stroke={selected ? "var(--accent)" : "#0f172a"}
                        strokeWidth={selected ? 2 : 1}
                    />
                )}
            </svg>
            <span style={{
                position: 'relative',
                zIndex: 1,
                pointerEvents: 'none',
                fontSize: '11px',
                fontWeight: 'bold',
                fontFamily: 'var(--font-sans)',
                textAlign: 'center',
                maxWidth: '60%' // Prevent text spilling out of diamond
            }}>
                {node.label}
            </span>
        </div>
    );
});
