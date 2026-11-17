/**
 * The step bar: shows the current step (index, date, and title), walks prev/next,
 * and opens the current step's card when clicked.
 */

export interface StepBarItem {
  label: string;
  date: string;
}

export interface StepBarOptions {
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  label: HTMLElement;
  onStep: (index: number) => void;
  onSelectCurrent?: (index: number) => void;
}

export class StepBar {
  private readonly options: StepBarOptions;
  private count = 0;
  private index = 0;

  constructor(options: StepBarOptions) {
    this.options = options;
    options.prev.addEventListener("click", () => {
      if (this.index > 0) {
        options.onStep(this.index - 1);
      }
    });
    options.next.addEventListener("click", () => {
      if (this.index < this.count - 1) {
        options.onStep(this.index + 1);
      }
    });
    options.label.addEventListener("click", () => {
      if (this.count > 0) {
        options.onSelectCurrent?.(this.index);
      }
    });
  }

  render(items: StepBarItem[], index: number): void {
    this.count = items.length;
    this.index = index;
    if (this.count === 0) {
      this.options.label.textContent = "No events in this span";
    } else {
      const current = items[index];
      const datePart = current?.date ? `${current.date} — ` : "";
      this.options.label.textContent = `${index + 1}/${this.count} · ${datePart}${current?.label ?? ""}`;
    }
    this.options.prev.disabled = this.count === 0 || index <= 0;
    this.options.next.disabled = this.count === 0 || index >= this.count - 1;
  }
}
