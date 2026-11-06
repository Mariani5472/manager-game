"use client";

import { create } from "zustand";

export type MenuSection = "home" | "new-game" | "load-game" | "config";

interface MenuState {
  activeSection: MenuSection;
  setActiveSection: (section: MenuSection) => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  activeSection: "home",
  setActiveSection: (activeSection) => set({ activeSection }),
}));
