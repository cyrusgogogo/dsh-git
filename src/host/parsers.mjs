import { GitError } from './git-runner.mjs';

const OID = /^[a-f\d]{40,64}$/i;
function fixedRows(output, count, lineSeparators = false) {
  if (!output) return [];
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (lineSeparators && fields.at(-1) === '\n') fields.pop();
  if (fields.length % count !== 0) throw new GitError('INVALID_GIT_OUTPUT', 'Git 输出不完整，请刷新后重试。');
  const rows = [];
  for (let i = 0; i < fields.length; i += count) {
    const row = fields.slice(i, i + count);
    if (lineSeparators) row[0] = row[0].replace(/^\n/, '');
    rows.push(row);
  }
  return rows;
}

function afterFields(text, count) {
  let position = -1;
  for (let i = 0; i < count; i++) position = text.indexOf(' ', position + 1);
  return text.slice(position + 1);
}
export function parseStatus(output) {
  const files = [], records = output.split('\0');
  let ahead = 0, behind = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('# branch.ab ')) {
      const match = record.match(/\+(\d+) -(\d+)/);
      if (match) [, ahead, behind] = match.map(Number);
      continue;
    }
    if (record.startsWith('# ') || !record) continue;
    const type = record[0];
    if (type === '?') files.push({ path: record.slice(2), index: '?', worktree: '?', staged: false, unstaged: true, conflict: false });
    if (['1', '2', 'u'].includes(type)) {
      const xy = record.split(' ')[1];
      files.push({
        path: afterFields(record, type === '1' ? 8 : type === '2' ? 9 : 10),
        ...(type === '2' ? { originalPath: records[++i] } : {}),
        index: xy[0], worktree: xy[1], staged: xy[0] !== '.', unstaged: xy[1] !== '.', conflict: type === 'u',
      });
    }
  }
  return { files, ahead: Number(ahead), behind: Number(behind) };
}
export function parseBranches(output) {
  return fixedRows(output, 8, true).flatMap(([ref, hash, upstream, track = '', date, subject, worktreePath, symbolic]) => {
    if (!ref.startsWith('refs/') || !OID.test(hash)) throw new GitError('INVALID_GIT_OUTPUT', 'Git 引用格式不合法。');
    if (symbolic) return [];
    const kind = ref.startsWith('refs/heads/') ? 'local' : ref.startsWith('refs/remotes/') ? 'remote' : 'tag';
    const name = ref.replace(/^refs\/(heads|remotes|tags)\//, '');
    return [{ ref, hash, kind, name, upstream: upstream || null, ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0), gone: track.includes('gone'), date, subject, worktreePath: worktreePath || null }];
  });
}
export function parseWorktrees(output) {
  const items = [];
  let current;
  for (const record of output.split('\0')) {
    if (!record) continue;
    const index = record.indexOf(' '), key = index < 0 ? record : record.slice(0, index), value = index < 0 ? '' : record.slice(index + 1);
    if (key === 'worktree') { current = { path: value, head: null, branch: null, detached: false, locked: false, lockReason: '', prunable: false, main: items.length === 0 }; items.push(current); }
    else if (current) {
      if (key === 'HEAD') current.head = value;
      if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
      if (key === 'detached') current.detached = true;
      if (key === 'locked') { current.locked = true; current.lockReason = value; }
      if (key === 'prunable') current.prunable = true;
      if (key === 'bare') current.bare = true;
    }
  }
  return items;
}
export function parseLog(output, body = false) {
  return fixedRows(output, body ? 8 : 7).map(([hash, parents, author, email, date, subject, decoration = '', message]) => {
    if (!OID.test(hash) || (parents && !parents.split(' ').every((parent) => OID.test(parent)))) throw new GitError('INVALID_GIT_OUTPUT', 'Git 提交格式不合法。');
    return { hash, parents: parents ? parents.split(' ') : [], author, email, date, subject, refs: decoration ? decoration.split(', ') : [], ...(body ? { message: message ?? subject } : {}) };
  });
}
export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D';
export function parseNameStatus(output) {
  const parts = output.split('\0'), files = [];
  for (let i = 0; i < parts.length && parts[i];) {
    const status = parts[i++];
    const path = parts[i++];
    if (/^[RC]/.test(status)) files.push({ status: status[0], originalPath: path, path: parts[i++] });
    else files.push({ status: status[0], path });
  }
  return files;
}
