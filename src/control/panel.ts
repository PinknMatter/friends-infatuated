// Auto-generates the control UI from the param registry: one collapsible
// section per group. This file is dumb on purpose — the registry is the truth.

import type { ParamDef, ParamStore } from '../core/params';

export function buildPanel(root: HTMLElement, params: ParamStore): void {
  const groups = new Map<string, ParamDef[]>();
  for (const def of params.allDefs()) {
    const arr = groups.get(def.group) ?? [];
    arr.push(def);
    groups.set(def.group, arr);
  }

  for (const [group, defs] of groups) {
    const details = document.createElement('details');
    details.open = !group.startsWith('fx:'); // effect knob sections start collapsed
    const summary = document.createElement('summary');
    summary.textContent = group;
    details.appendChild(summary);

    for (const def of defs) {
      details.appendChild(buildRow(def, params));
    }
    root.appendChild(details);
  }
}

function buildRow(def: ParamDef, params: ParamStore): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.textContent = def.label;
  label.title = def.path;
  row.appendChild(label);

  switch (def.type) {
    case 'float':
    case 'int': {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(def.min ?? 0);
      input.max = String(def.max ?? 1);
      input.step = String(def.step ?? (def.type === 'int' ? 1 : 0.01));
      input.value = String(params.get(def.path));
      const value = document.createElement('span');
      value.className = 'val';
      value.textContent = fmt(params.num(def.path));
      input.addEventListener('input', () => {
        params.set(def.path, Number(input.value));
      });
      params.onChange(def.path, (v) => {
        input.value = String(v);
        value.textContent = fmt(Number(v));
      });
      row.appendChild(input);
      row.appendChild(value);
      break;
    }
    case 'bool': {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = params.bool(def.path);
      input.addEventListener('change', () => params.set(def.path, input.checked));
      params.onChange(def.path, (v) => {
        input.checked = Boolean(v);
      });
      row.appendChild(input);
      break;
    }
    case 'enum': {
      const select = document.createElement('select');
      select.dataset.path = def.path;
      for (const opt of def.options ?? []) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
      }
      select.value = params.str(def.path);
      select.addEventListener('change', () => params.set(def.path, select.value));
      params.onChange(def.path, (v) => {
        select.value = String(v);
      });
      row.appendChild(select);
      break;
    }
    case 'trigger': {
      const button = document.createElement('button');
      button.textContent = def.label;
      button.addEventListener('click', () => params.trigger(def.path));
      label.textContent = '';
      row.appendChild(button);
      break;
    }
  }
  return row;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
