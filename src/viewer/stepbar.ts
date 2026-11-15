/**
 * The step bar: which step we are on, and the buttons to walk to the next
 * one.
 */

export interface StepBarOptions {
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  label: HTMLElement;
  onStep: (index: number) => void;
}

export class StepBar {
  private readonly options: StepBarOptions;
  private count = 0;
  private index = 0;

  constructor(options: StepBarOptions) {
    this.options = options;
    options.prev.addEventListener("click", () => options.onStep(this.index - 1));
    options.next.addEventListener("click", () => options.onStep(this.index + 1));
  }

  render(labels: string[], index: number): void {
    this.count = labels.length;
    this.index = index;
    if (this.count === 0) {
      this.options.label.textContent = "No steps here";
    } else {
      this.options.label.textContent = `${index + 1}/${this.count} · ${labels[index] ?? ""}`;
    }
    this.options.prev.disabled = this.count === 0 || index <= 0;
    this.options.next.disabled = this.count === 0 || index >= this.count - 1;
  }
}
