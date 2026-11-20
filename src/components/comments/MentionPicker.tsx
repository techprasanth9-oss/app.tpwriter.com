import type { PublicUser } from "~/lib/api/collab";
import { initials, userName } from "~/lib/editor/comments/mentions";

export interface MentionPickerProps {
  id: string;
  options: PublicUser[];
  activeIndex: number;
  onPick(user: PublicUser): void;
  onHover(index: number): void;
}

export const mentionOptionId = (listId: string, i: number) => `${listId}-opt-${i}`;

/** Listbox of members under the composer; focus stays in the textarea
 *  (which owns `aria-activedescendant`). */
export function MentionPicker({ id, options, activeIndex, onPick, onHover }: MentionPickerProps) {
  if (!options.length) return null;
  return (
    <ul className="tp-mention-picker" role="listbox" id={id} aria-label="Mention someone">
      {options.map((u, i) => (
        <li
          key={u.id}
          id={mentionOptionId(id, i)}
          role="option"
          aria-selected={i === activeIndex}
          className="tp-mention-option"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(u);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="tp-avatar tp-avatar--sm" aria-hidden="true">
            {initials(u)}
          </span>
          <span className="tp-mention-option-text">
            <span className="tp-mention-option-name">{userName(u)}</span>
            <span className="tp-mention-option-email">{u.email}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
