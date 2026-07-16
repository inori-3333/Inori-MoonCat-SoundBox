export const terms = {
  centerImage: { label: "中心声像", note: "左右声道共同形成的声音位置；理想的单声道信号通常位于头部中央。" },
  polarity: { label: "极性", note: "两个声道振动方向的相对关系；反常时可能让中心声音变得松散。" },
  seal: { label: "低频密封", note: "耳塞或耳罩与皮肤贴合程度；漏气通常会优先削弱低频。" },
  logarithmicSweep: { label: "对数扫频", note: "按倍频程匀速经过频率范围，更接近人耳对频率间隔的感知。" },
  dbfs: { label: "dBFS", note: "数字音频电平，不等于耳边实际声压或安全 SPL。" },
  confidence: { label: "置信度", note: "表示现象在当前流程中的可重复程度，不是实验室测量精度。" }
} as const;

export const copy = {
  productName: "HiFi Box",
  productSubtitle: "耳机听感体检",
  limitation: "结果反映个人听觉、佩戴、播放链路与耳机的共同作用，不是实验室参数或医疗结论。",
  safety: "从很小的音量开始。应用无法读取耳机灵敏度、DAC 硬件音量或实际声压。"
} as const;
