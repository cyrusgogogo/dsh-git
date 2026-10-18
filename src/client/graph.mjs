/* Lane colours reference theme-adaptive CSS tokens (see styles.css) so the
   graph keeps its contrast on both dark and light host surfaces. */
export const GRAPH_COLORS = ['var(--git-graph-1)', 'var(--git-graph-2)', 'var(--git-graph-3)', 'var(--git-graph-4)', 'var(--git-graph-5)', 'var(--git-graph-6)'];

/** Keep lanes stable across rows; every edge is derived from actual parent OIDs. */
export function layoutGraph(commits) {
  let lanes = [];
  let maxLanes = 1;
  const rows = commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    const connectedFromAbove = lane !== -1;
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) lane = lanes.length; lanes[lane] = commit.hash; }
    const before = [...lanes];
    lanes[lane] = null;
    const parents = commit.parents.map((parent, index) => {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = index === 0 && lanes[lane] === null ? lane : lanes.indexOf(null);
        if (target === -1) target = lanes.length;
        lanes[target] = parent;
      }
      return { lane: target, hash: parent };
    });
    const through = before.flatMap((hash, index) => hash && index !== lane ? [{ from: index, to: lanes.indexOf(hash) }] : []);
    maxLanes = Math.max(maxLanes, lanes.length, before.length);
    return { lane, connectedFromAbove, parents, through };
  });
  return { rows, width: Math.max(34, maxLanes * 14 + 12) };
}

export function relativeDate(iso) {
  const value = new Date(iso);
  if (Number.isNaN(value.valueOf())) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - value.valueOf()) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)} 天前`;
  return value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
