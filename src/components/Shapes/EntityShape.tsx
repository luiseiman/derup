import React, { memo } from 'react';
import type { EntityNode } from '../../types/er';

interface EntityProps {
    node: EntityNode;
    selected: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
}

export const EntityShape: React.FC<EntityProps> = memo(({ node, selected, onMouseDown }) => {
    const isWeak = node.isWeak;

    // Dimensions - could be dynamic based on text, but fixed for now or passed in
    const width = 100;
    const height = 50;

    return (
        <div
            style={{ width, height, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' }}
            onMouseDown={onMouseDown}
        >
            <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                {/* Outer Rect */}
                <rect
                    x={1} y={1}
                    width={width - 2} height={height - 2}
                    fill="white"
                    stroke={selected ? "var(--accent)" : "#0f172a"}
                    strokeWidth={selected ? 2 : 1}
                />
                {/* Inner Rect for Weak Entity */}
                {isWeak && (
                    <rect
                        x={6} y={6}
                        width={width - 12} height={height - 12}
                        fill="none"
                        stroke={selected ? "var(--accent)" : "#0f172a"}
                        strokeWidth={1}
                    />
                )}
            </svg>
            <span style={{
                position: 'relative',
                zIndex: 1,
                pointerEvents: 'none',
                fontSize: '12px',
                fontWeight: 'bold',
                fontFamily: 'var(--font-family)',
            }}>
                {node.label}
            </span>
        </div>
    );
});
