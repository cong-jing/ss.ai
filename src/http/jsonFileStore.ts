import fs from "node:fs";
import path from "node:path";

export class JsonFileStore<T extends object> {
    constructor(
        private readonly filePath: string,
        private readonly defaultValue: T
    ) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        if (!fs.existsSync(this.filePath)) {
            this.write(this.defaultValue);
        }
    }

    read(): T {
        if (!fs.existsSync(this.filePath)) {
            this.write(this.defaultValue);
            return { ...this.defaultValue };
        }

        const raw = fs.readFileSync(this.filePath, "utf-8");
        return { ...this.defaultValue, ...(JSON.parse(raw) as Partial<T>) };
    }

    write(value: T): void {
        fs.writeFileSync(this.filePath, JSON.stringify(value, null, 2), "utf-8");
    }

    update(patch: Partial<T>): T {
        const current = this.read();
        const next = { ...current, ...patch };
        this.write(next);
        return next;
    }
}
