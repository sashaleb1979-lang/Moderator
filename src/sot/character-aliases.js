"use strict";

const LEGACY_CHARACTER_ROLE_ALIASES = Object.freeze({
  honored_one: ["Годжо"],
  vessel: ["Юджи"],
  restless_gambler: ["Хакари"],
  ten_shadows: ["Мегуми"],
  perfection: ["Махито"],
  blood_manipulator: ["Чосо"],
  switcher: ["Тодо"],
  defense_attorney: ["Хигурума", "Хигурама"],
  cursed_partners: ["Юта", "Юта Оккоцу"],
  head_of_the_hei: ["Наоя", "Наобито"],
  puppet_master: ["Мехамару"],
  salaryman: ["Нанами"],
  locust_guy: ["Локуст Гай", "Локуст"],
  star_rage: ["Юки"],
  aspiring_mangaka: ["Чарльз", "Шарль"],
  lucky_coward: ["Харута"],
  disaster_plants: ["Ханами"],
  crow_charmer: ["Мэй Мэй", "Мей Мей", "Мэй-Мэй", "Меи Меи"],
  ryu: ["Рю", "Рю Ишигори"],
});

function cleanString(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function getCharacterAliasNames(characterId = "") {
  const id = cleanString(characterId, 120);
  const values = Array.isArray(LEGACY_CHARACTER_ROLE_ALIASES[id]) ? LEGACY_CHARACTER_ROLE_ALIASES[id] : [];
  return [...new Set(values.map((value) => cleanString(value, 200)).filter(Boolean))];
}

module.exports = {
  getCharacterAliasNames,
  LEGACY_CHARACTER_ROLE_ALIASES,
};