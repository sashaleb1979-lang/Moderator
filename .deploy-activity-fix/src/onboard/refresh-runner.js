"use strict";

async function commitMutation({ mutate, persist, scope = "none", refreshers = {} }) {
  if (typeof mutate === "function") mutate();
  if (typeof persist === "function") persist();

  switch (scope) {
    case "welcome":
      return refreshers.refreshWelcomePanel ? refreshers.refreshWelcomePanel() : null;
    case "graphic":
      return refreshers.refreshGraphicTierlistBoard ? refreshers.refreshGraphicTierlistBoard() : null;
    case "text":
      return refreshers.refreshTextTierlistBoard ? refreshers.refreshTextTierlistBoard() : null;
    case "tierlists":
      return refreshers.refreshAllTierlists ? refreshers.refreshAllTierlists() : null;
    case "all":
      return refreshers.refreshAll ? refreshers.refreshAll() : null;
    default:
      return null;
  }
}

module.exports = {
  commitMutation,
};
