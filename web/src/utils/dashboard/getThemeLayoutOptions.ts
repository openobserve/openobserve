export const getThemeLayoutOptions = (store: any) => ({
  paper_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
  plot_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
  font: {
    size: 12,
    color: store.state.theme === "dark" ? "#fff" : "#181a1b",
  },
});
