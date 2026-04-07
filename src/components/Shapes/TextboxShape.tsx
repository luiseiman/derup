import React, { memo } from 'react';
import type { TextboxNode } from '../../types/er';

interface TextboxProps {
    node: TextboxNode;
    selected: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
}

export const TextboxShape: React.FC<TextboxProps> = memo(({ node, selected, onMouseDown }) => {
    const text = node.text || node.label || '';

    return (
        <div
            style={{
                minWidth: 80,
                minHeight: 30,
                maxWidth: 250,
                padding: '8px 12px',
                background: selected ? 'rgba(243, 232, 255, 0.95)' : 'rgba(255, 255, 255, 0.85)',
                border: `1.5px ${selected ? 'solid var(--accent)' : 'dashed #94a3b8'}`,
                borderRadius: 6,
                cursor: 'grab',
                userSelect: 'none',
                fontSize: '12px',
                fontFamily: 'var(--font-family)',
                color: '#334155',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                filter: selected ? 'drop-shadow(0 0 4px rgba(147,51,234,0.3))' : undefined,
                zIndex: selected ? 10 : undefined,
            }}
            onMouseDown={onMouseDown}
        >
            {text}
        </div>
    );
});
