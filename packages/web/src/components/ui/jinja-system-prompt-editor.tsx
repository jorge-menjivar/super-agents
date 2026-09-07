'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { jinjaExtensions } from '@web/components/text-editor/extensions';
import { cn } from '@web/utils/ui/utils';
import { forwardRef, useEffect, useImperativeHandle } from 'react';

export interface JinjaSystemPromptEditorProps {
  value?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onBlur?: () => void;
}

export interface JinjaSystemPromptEditorRef {
  focus: () => void;
  getHTML: () => string;
  getText: () => string;
  setContent: (content: string) => void;
}

export const JinjaSystemPromptEditor = forwardRef<
  JinjaSystemPromptEditorRef,
  JinjaSystemPromptEditorProps
>(({ value = '', placeholder, className, disabled, onChange, onBlur }, ref) => {
  const editor = useEditor({
    extensions: [...jinjaExtensions()],
    editorProps: {
      attributes: {
        class:
          'prose-base prose-stone dark:prose-invert prose-headings:font-title font-default focus:outline-none max-w-full w-full min-h-[120px]',
        'data-placeholder':
          placeholder || 'You are a helpful AI assistant that...',
      },
    },
    content: value,
    immediatelyRender: true,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      onChange?.(text);
    },
    onBlur: () => {
      onBlur?.();
    },
  });

  useImperativeHandle(ref, () => ({
    focus: () => {
      editor?.chain().focus().run();
    },
    getHTML: () => {
      return editor?.getHTML() ?? '';
    },
    getText: () => {
      return editor?.getText() ?? '';
    },
    setContent: (content: string) => {
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(content);
      }
    },
  }));

  // The editor `useEditor` hands out can already be destroyed; see
  // `TextViewer`. A destroyed editor has no commands to call.
  useEffect(() => {
    if (editor && !editor.isDestroyed && value !== editor.getText()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div
        className={cn(
          'min-h-[120px] rounded-md border border-input bg-background px-3 py-2',
          'flex items-start text-sm text-muted-foreground',
          className,
        )}
      >
        <div className="animate-pulse">Loading editor...</div>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: Wrapper uses role button semantics to be focusable and clickable
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={cn(
        'flex w-full min-h-[120px] overflow-hidden',
        'rounded-md border border-input bg-background p-3',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onClick={() => {
        if (!disabled) {
          editor?.chain().focus().run();
        }
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          editor?.chain().focus().run();
        }
      }}
    >
      <EditorContent
        editor={editor}
        className="flex editor w-full h-fit font-editor antialiased break-keep"
      />
    </div>
  );
});

JinjaSystemPromptEditor.displayName = 'JinjaSystemPromptEditor';
