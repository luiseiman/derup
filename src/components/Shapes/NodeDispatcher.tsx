import React from 'react';
import type { ERNode, EntityNode, RelationshipNode, AttributeNode, ISANode } from '../../types/er';
import { EntityShape } from './EntityShape';
import { RelationshipShape } from './RelationshipShape';
import { AttributeShape } from './AttributeShape';
import { ISAShape } from './ISAShape';

interface NodeDispatcherProps {
    node: ERNode;
    onMouseDown: (e: React.MouseEvent) => void;
}

export const NodeDispatcher: React.FC<NodeDispatcherProps> = ({ node, onMouseDown }) => {
    const selected = !!node.selected;

    const style: React.CSSProperties = {
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
        pointerEvents: 'auto', // Re-enable pointer events blocked by canvas-content
    };

    let content = null;
    switch (node.type) {
        case 'entity':
            content = <EntityShape node={node as EntityNode} selected={selected} onMouseDown={onMouseDown} />;
            break;
        case 'relationship':
            content = <RelationshipShape node={node as RelationshipNode} selected={selected} onMouseDown={onMouseDown} />;
            break;
        case 'attribute':
            content = <AttributeShape node={node as AttributeNode} selected={selected} onMouseDown={onMouseDown} />;
            break;
        case 'isa':
            content = <ISAShape node={node as ISANode} selected={selected} onMouseDown={onMouseDown} />;
            break;
        default:
            content = null;
    }

    return (
        <div style={style} onMouseDown={onMouseDown}>
            {content}
        </div>
    );
};
