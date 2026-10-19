import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

// shadcn/ui's Radix Select composition, styled with the plugin's host-derived
// tokens rather than a global Tailwind theme. Portals must carry dsh-git too.
export const SelectGroup = SelectPrimitive.Group;

export function SelectControl({ value, onValueChange, label, prefix, icon: Icon, placeholder, title, disabled = false, className = '', contentClassName = '', align = 'start', children }) {
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectPrimitive.Trigger aria-label={label} title={title} className={`git-select-trigger ${className}`}>
      {Icon && <Icon size={14} strokeWidth={1.6} className="git-select-icon" aria-hidden="true" />}
      {prefix && <span className="git-select-prefix" aria-hidden="true">{prefix}</span>}
      <SelectPrimitive.Value className="git-select-value" placeholder={placeholder} />
      <SelectPrimitive.Icon asChild><ChevronDown size={13} strokeWidth={1.6} className="git-select-chevron" aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" align={align} sideOffset={5} collisionPadding={8} className={`dsh-git git-select-content ${contentClassName}`}>
        <SelectPrimitive.ScrollUpButton className="git-select-scroll"><ChevronUp size={13} aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="git-select-viewport">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="git-select-scroll"><ChevronDown size={13} aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}

export const SelectItem = React.forwardRef(function SelectItem({ value, children, icon: Icon, description, className = '', ...props }, ref) {
  const descriptionId = React.useId();
  return <SelectPrimitive.Item ref={ref} value={value} aria-describedby={description ? descriptionId : undefined} className={`git-select-item ${className}`} {...props}>
    {Icon && <Icon size={14} strokeWidth={1.6} className="git-select-item-icon" aria-hidden="true" />}
    <span className="git-select-item-copy"><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>{description && <span id={descriptionId} className="git-select-description" title={description}>{description}</span>}</span>
    <span className="git-select-indicator"><SelectPrimitive.ItemIndicator><Check size={14} strokeWidth={1.8} aria-hidden="true" /></SelectPrimitive.ItemIndicator></span>
  </SelectPrimitive.Item>;
});

export function SelectLabel({ children }) {
  return <SelectPrimitive.Label className="git-select-label">{children}</SelectPrimitive.Label>;
}
export function SelectSeparator() {
  return <SelectPrimitive.Separator className="git-select-separator" />;
}
