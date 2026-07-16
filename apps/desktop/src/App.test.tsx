import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";

describe("HiFi Box desktop flow", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("opens on the offline guided-check workspace", async () => {
    render(<App />);
    expect(await screen.findByText("先确认播放链路，", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("完全离线")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始完整体检/ })).toBeDisabled();
  });

  it("creates a local headphone profile", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /新建档案/ }));
    fireEvent.change(screen.getByPlaceholderText("例如 Sennheiser"), { target: { value: "Moondrop" } });
    fireEvent.change(screen.getByPlaceholderText("例如 HD 600"), { target: { value: "Blessing" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(screen.getAllByText(/Moondrop Blessing/).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /开始完整体检/ })).toBeEnabled();
  });

  it("documents the no-network and no-measurement limits", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    expect(await screen.findByText("不使用麦克风，也不测量频响、THD 或真实声压。")).toBeInTheDocument();
    expect(screen.getByText("没有账户、云同步、遥测、在线素材或自动更新。")).toBeInTheDocument();
  });
});
