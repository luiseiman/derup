import React from 'react';
import type { ISANode } from '../../types/er';


interface ISAShapeProps {
    node: ISANode;
    selected: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
}

export const ISAShape: React.FC<ISAShapeProps> = ({ node, selected, onMouseDown }) => {
    const width = 70;
    const height = 60;
    const constraintLabels: string[] = [];
    if (node.isDisjoint) constraintLabels.push('d');
    if (node.isTotal) constraintLabels.push('t');
    const constraintText = constraintLabels.join(',');

    return (
        <div
            style={{
                width: width,
                height: height,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'grab',
                zIndex: selected ? 10 : undefined,
                filter: selected ? 'drop-shadow(0 0 6px #9333ea) drop-shadow(0 0 14px rgba(147,51,234,0.45))' : undefined,
            }}
            onMouseDown={onMouseDown}
        >
            <svg width={width} height={height} style={{ overflow: 'visible' }}>
                <polygon
                    points={`${width / 2},2 ${width - 2},${height - 2} 2,${height - 2}`}
                    fill={selected ? "#f3e8ff" : "white"}
                    stroke={selected ? "var(--accent)" : "#0f172a"}
                    strokeWidth={selected ? 3.5 : 2}
                />
                <text
                    x="50%"
                    y="58%"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="bold"
                    fontFamily="var(--font-sans)"
                >
                    {node.label || 'ES'}
                </text>
                {constraintText && (
                    <text
                        x="50%"
                        y="82%"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fontSize="9"
                    fill={selected ? "var(--accent)" : "#64748b"}
                    fontFamily="var(--font-sans)"
                >
                        {constraintText}
                    </text>
                )}
            </svg>
        </div>
    );
};
