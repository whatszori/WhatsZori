import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ChatFilter } from '../../stores/chat-selectors';
import { useChats } from '../../stores/chats';
import { Button, Dialog, Input, Menu, type MenuEntry, type PopoverAnchor } from '../../ui';
import './FilterChips.css';

const BUILT_IN: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'groups', label: 'Groups' },
];

// A dialog with one name field, for creating and renaming lists.
export function NameDialog({
  open,
  title,
  initial = '',
  action,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial?: string;
  action: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
    onClose();
  };
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      width={360}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="wz-name-dialog" disabled={!name.trim()}>
            {action}
          </Button>
        </>
      }
    >
      <form id="wz-name-dialog" onSubmit={submit}>
        <Input
          aria-label="List name"
          placeholder="e.g. Work, Family, Study"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Dialog>
  );
}

export function FilterChips() {
  const filter = useChats((s) => s.filter);
  const lists = useChats((s) => s.lists);
  const { setFilter } = useChats.getState();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ id: number; anchor: PopoverAnchor } | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const options: { value: ChatFilter; label: string; list?: number }[] = [
    ...BUILT_IN,
    ...lists.map((l) => ({ value: `list:${l.id}` as ChatFilter, label: l.name, list: l.id })),
  ];

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === filter);
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    setFilter(options[next].value);
    row.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const menuList = menu ? lists.find((l) => l.id === menu.id) : undefined;
  const menuItems: MenuEntry[] = menuList
    ? [
        {
          id: 'rename',
          label: 'Rename',
          icon: <Pencil />,
          onSelect: () => setRenaming({ id: menuList.id, name: menuList.name }),
        },
        {
          id: 'delete',
          label: 'Delete list',
          icon: <Trash2 />,
          danger: true,
          onSelect: () => void useChats.getState().deleteList(menuList.id),
        },
      ]
    : [];

  return (
    <>
      <div
        ref={row}
        className="wz-chips"
        role="tablist"
        aria-label="Filter chats"
        onKeyDown={onKeyDown}
        // the wheel scrolls the row sideways; it has no scrollbar
        onWheel={(e) => {
          if (e.deltaY && row.current) row.current.scrollLeft += e.deltaY;
        }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={filter === o.value}
            tabIndex={filter === o.value ? 0 : -1}
            className={`wz-chip${filter === o.value ? ' wz-chip--on' : ''}`}
            onClick={() => setFilter(o.value)}
            onContextMenu={(e) => {
              if (o.list === undefined) return;
              e.preventDefault();
              setMenu({ id: o.list, anchor: { x: e.clientX, y: e.clientY } });
            }}
            title={o.list !== undefined ? 'Right-click to rename or delete' : undefined}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          className="wz-chip wz-chip--add"
          aria-label="New list"
          title="New list"
          onClick={() => setCreating(true)}
        >
          <Plus size={14} />
        </button>
      </div>
      <Menu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={closeMenu}
        items={menuItems}
        label="List"
      />
      {creating && (
        <NameDialog
          open
          title="New list"
          action="Create"
          onClose={() => setCreating(false)}
          onSubmit={(name) =>
            void useChats
              .getState()
              .createList(name)
              .then((l) => l && setFilter(`list:${l.id}`))
          }
        />
      )}
      {renaming && (
        <NameDialog
          open
          title="Rename list"
          action="Rename"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => void useChats.getState().renameList(renaming.id, name)}
        />
      )}
    </>
  );
}
