import { useEffect } from "react";
import {
  Controller,
  useFieldArray,
  type ArrayPath,
  type Control,
  type FieldValues,
  type FieldArray,
  type Path,
} from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "./Input";
import { Button } from "./Button";

interface Props<T extends FieldValues> {
  control: Control<T>;
  name: ArrayPath<T>;
  placeholder?: string;
  minRows?: number;
  arrayError?: string;
}

/**
 * 行追加/削除が可能な URL 入力リスト。
 * react-hook-form の `useFieldArray` は配列要素がオブジェクトである必要があるため、
 * 各要素は `{ value: string }` 形式で保持する (`lib/schemas.ts` の `urlItem` と対応)。
 * `minRows` を下回る場合は自動で 1 行を append する (redirect_uris 等の「常に 1 行必要」要件に対応)。
 */
export function RepeatableInput<T extends FieldValues>({
  control,
  name,
  placeholder,
  minRows = 0,
  arrayError,
}: Props<T>) {
  const { fields, append, remove } = useFieldArray<T>({ control, name });

  useEffect(() => {
    if (fields.length < minRows) {
      append({ value: "" } as unknown as FieldArray<T, ArrayPath<T>>);
    }
  }, [fields.length, minRows, append]);

  return (
    <div className="space-y-2">
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-start gap-2">
          <div className="flex-1">
            <Controller
              control={control}
              name={`${name}.${index}.value` as Path<T>}
              render={({ field: f, fieldState }) => (
                <>
                  <Input
                    value={typeof f.value === "string" ? f.value : ""}
                    onChange={f.onChange}
                    onBlur={f.onBlur}
                    name={f.name}
                    ref={f.ref}
                    placeholder={placeholder}
                    type="url"
                  />
                  {fieldState.error?.message && (
                    <p className="mt-1 text-xs text-red-400">{fieldState.error.message}</p>
                  )}
                </>
              )}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(index)}
            disabled={fields.length <= minRows}
            aria-label="この行を削除"
            className={[
              "mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md",
              "border border-zinc-800 bg-zinc-900/60 text-zinc-400",
              "hover:border-red-900/60 hover:text-red-300 hover:bg-red-950/30",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:text-zinc-400 disabled:hover:bg-zinc-900/60",
              "transition-colors",
            ].join(" ")}
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      ))}
      {arrayError && <p className="text-xs text-red-400">{arrayError}</p>}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => append({ value: "" } as unknown as FieldArray<T, ArrayPath<T>>)}
        leftIcon={<Plus className="h-3.5 w-3.5" />}
      >
        追加
      </Button>
    </div>
  );
}
