const DEFAULT_GRAPHIC_TIER_COLORS = {
  5: "#d7263d",
  4: "#f46036",
  3: "#f9c74f",
  2: "#43aa8b",
  1: "#4d96ff",
};

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function getTierColor(colors, tier) {
  return String(colors?.[tier] || colors?.[String(tier)] || DEFAULT_GRAPHIC_TIER_COLORS[tier] || "#8892a0");
}

function buildStatsCards(stats, tierColors) {
  return [
    {
      title: "Подтверждено",
      value: formatNumber(stats.totalVerified),
      color: "#24304a",
    },
    {
      title: "Pending",
      value: formatNumber(stats.pendingCount),
      color: "#3a2942",
    },
    {
      title: "Kills суммарно",
      value: formatNumber(stats.totalKills),
      color: "#24363d",
    },
    {
      title: "Среднее",
      value: formatNumber(stats.averageKills),
      color: "#2e3149",
    },
    {
      title: "Топ 1",
      value: stats.topEntry ? truncateText(`${stats.topEntry.displayName} • ${formatNumber(stats.topEntry.approvedKills)}`, 24) : "—",
      color: getTierColor(tierColors, stats.topEntry?.killTier || 5),
    },
  ];
}

function buildTierSummary(stats, tierLabels, tierColors) {
  return [5, 4, 3, 2, 1].map((tier) => ({
    tier,
    label: tierLabels?.[tier] || tierLabels?.[String(tier)] || `Tier ${tier}`,
    total: Number(stats?.totalsByTier?.[tier] || 0),
    color: getTierColor(tierColors, tier),
  }));
}

function buildGraphicTierlistSvg(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries.slice(0, 12) : [];
  const stats = input.stats || {
    totalVerified: 0,
    pendingCount: 0,
    totalKills: 0,
    averageKills: 0,
    totalsByTier: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    topEntry: null,
  };
  const title = truncateText(input.title || "Графический тир-лист", 54);
  const subtitle = truncateText(input.subtitle || "Подтверждённые игроки и текущая расстановка по kills", 110);
  const tierLabels = input.tierLabels || {};
  const tierColors = { ...DEFAULT_GRAPHIC_TIER_COLORS, ...(input.tierColors || {}) };
  const cards = buildStatsCards(stats, tierColors);
  const tierSummary = buildTierSummary(stats, tierLabels, tierColors);

  const width = 1600;
  const height = 1080;
  const cardWidth = 720;
  const cardHeight = 98;
  const cardGapX = 28;
  const cardGapY = 20;
  const startX = 70;
  const startY = 360;

  const rankingCards = entries.map((entry, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = startX + column * (cardWidth + cardGapX);
    const y = startY + row * (cardHeight + cardGapY);
    const mains = truncateText((entry.mains || []).join(", ") || "Без мейнов", 34);
    const displayName = truncateText(entry.displayName || `User ${entry.userId || "?"}`, 24);
    const kills = formatNumber(entry.approvedKills);
    const tier = Number(entry.killTier || 1);
    const tierColor = getTierColor(tierColors, tier);

    return `
      <g transform="translate(${x} ${y})">
        <rect width="${cardWidth}" height="${cardHeight}" rx="26" fill="#111827" fill-opacity="0.88" stroke="${tierColor}" stroke-width="3"/>
        <circle cx="56" cy="49" r="30" fill="${tierColor}"/>
        <text x="56" y="59" text-anchor="middle" fill="#08101d" font-size="28" font-weight="700">${index + 1}</text>
        <text x="108" y="42" fill="#f8fafc" font-size="29" font-weight="700">${escapeXml(displayName)}</text>
        <text x="108" y="72" fill="#bfd5ff" font-size="20">${escapeXml(mains)}</text>
        <g transform="translate(560 22)">
          <rect width="134" height="28" rx="14" fill="${tierColor}"/>
          <text x="67" y="20" text-anchor="middle" fill="#08101d" font-size="17" font-weight="700">T${tier} • ${escapeXml(truncateText(tierLabels?.[tier] || tierLabels?.[String(tier)] || `Tier ${tier}`, 12))}</text>
        </g>
        <text x="560" y="78" fill="#ffffff" font-size="25" font-weight="700">${kills} kills</text>
      </g>`;
  }).join("");

  const statsMarkup = cards.map((card, index) => {
    const x = 70 + index * 292;
    return `
      <g transform="translate(${x} 150)">
        <rect width="252" height="124" rx="28" fill="${card.color}" fill-opacity="0.96" stroke="#ffffff" stroke-opacity="0.06"/>
        <text x="28" y="44" fill="#c8d6f1" font-size="20">${escapeXml(card.title)}</text>
        <text x="28" y="88" fill="#ffffff" font-size="34" font-weight="700">${escapeXml(card.value)}</text>
      </g>`;
  }).join("");

  const tierSummaryMarkup = tierSummary.map((item, index) => {
    const x = 72 + index * 300;
    return `
      <g transform="translate(${x} 297)">
        <rect width="250" height="34" rx="17" fill="#172033"/>
        <rect width="${Math.min(250, 28 + item.total * 22)}" height="34" rx="17" fill="${item.color}"/>
        <text x="18" y="23" fill="#08101d" font-size="16" font-weight="700">T${item.tier}</text>
        <text x="56" y="23" fill="#08101d" font-size="16">${escapeXml(truncateText(item.label, 14))}</text>
        <text x="228" y="23" text-anchor="end" fill="#08101d" font-size="16" font-weight="700">${item.total}</text>
      </g>`;
  }).join("");

  const emptyState = entries.length
    ? ""
    : `
      <g transform="translate(70 404)">
        <rect width="1460" height="310" rx="36" fill="#111827" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.08"/>
        <text x="730" y="150" text-anchor="middle" fill="#ffffff" font-size="44" font-weight="700">Пока нет подтверждённых игроков</text>
        <text x="730" y="210" text-anchor="middle" fill="#cbd5e1" font-size="26">Как только модераторы начнут approving заявок, здесь появится визуальный рейтинг.</text>
      </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1600" y2="1080" gradientUnits="userSpaceOnUse">
      <stop stop-color="#09111f"/>
      <stop offset="0.5" stop-color="#101a2f"/>
      <stop offset="1" stop-color="#1b1024"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1080" fill="url(#bg)"/>
  <circle cx="1290" cy="140" r="220" fill="#f46036" fill-opacity="0.12"/>
  <circle cx="180" cy="920" r="240" fill="#4d96ff" fill-opacity="0.12"/>
  <rect x="44" y="36" width="1512" height="1008" rx="42" fill="url(#shine)" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.07"/>
  <text x="70" y="88" fill="#f8fafc" font-size="52" font-weight="700">${escapeXml(title)}</text>
  <text x="70" y="124" fill="#cbd5e1" font-size="24">${escapeXml(subtitle)}</text>
  ${statsMarkup}
  ${tierSummaryMarkup}
  ${rankingCards}
  ${emptyState}
  <text x="70" y="1030" fill="#b6c2d4" font-size="20">Полный порядок игроков смотри в текстовом тир-листе ниже. Обновлено автоматически.</text>
</svg>`;
}

module.exports = {
  DEFAULT_GRAPHIC_TIER_COLORS,
  buildGraphicTierlistSvg,
};