import { ref, watch, type Ref } from "vue";

/**
 * A reactive ref backed by localStorage.
 * Changes to the ref are persisted; the initial value is read from localStorage.
 */
export function useLocalStorage(key: string, defaultValue: boolean): Ref<boolean>;
export function useLocalStorage(key: string, defaultValue: number): Ref<number>;
export function useLocalStorage(key: string, defaultValue: string): Ref<string>;
export function useLocalStorage<T>(key: string, defaultValue: T): Ref<T> {
    const stored = localStorage.getItem(key);
    const initial: T = stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    const value = ref<T>(initial) as Ref<T>;

    watch(value, (v) => {
        localStorage.setItem(key, JSON.stringify(v));
    });

    return value;
}
