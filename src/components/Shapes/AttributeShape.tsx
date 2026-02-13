import React, { memo } from 'react';
import type { AttributeNode } from '../../types/er';

interface AttributeProps {
    node: AttributeNode;
    selected: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
}

export const AttributeShape: React.FC<AttributeProps> = memo(({ node, selected, onMouseDown }) => {
    const { isKey, isMultivalued, isDerived } = node;

    // Dimensions
    const width = 80;
    const height = 40;

    return (
        <div
            style={{ width, height, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' }}
            onMouseDown={onMouseDown}
        >
            <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                <ellipse
                    cx={width / 2} cy={height / 2}
                    rx={width / 2 - 2} ry={height / 2 - 2}
                    fill="white"
                    stroke={selected ? "var(--accent)" : "#0f172a"}
                    strokeWidth={selected ? 2 : 1}
                    strokeDasharray={isDerived ? "4" : "none"}
                />
                {isMultivalued && (
                    <ellipse
                        cx={width / 2} cy={height / 2}
                        rx={width / 2 - 6} ry={height / 2 - 6}
                        fill="none"
                        stroke={selected ? "var(--accent)" : "#0f172a"}
                        strokeWidth={1}
                        strokeDasharray={isDerived ? "4" : "none"}
                    />
                )}
            </svg>
            <span style={{
                position: 'relative',
                zIndex: 1,
                pointerEvents: 'none',
                fontSize: '11px',
                fontFamily: 'var(--font-family)',
                textAlign: 'center',
                textDecoration: isKey ? 'underline' : 'none'
            }}>
                {node.label}
            </span>
        </div>
    );
});
