export function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}


export function code(
  value: unknown,
  label: string
): string {
  assert(
    typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value),
    `${label} must be a 1–64 character stable code ` +
      "(letters, digits, dot, underscore or hyphen)."
  );

  return value;
}


export function textValue(
  value: unknown,
  label: string
): string {
  assert(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 200,
    `${label} must be a non-empty string of at most 200 characters.`
  );

  return value.trim();
}


export function positiveInt(
  value: unknown,
  label: string,
  allowZero = false
): number {
  assert(
    Number.isSafeInteger(value) &&
      (value as number) >= (allowZero ? 0 : 1),
    `${label} must be an integer ${
      allowZero
        ? ">= 0"
        : "> 0"
    }.`
  );

  return value as number;
}


export function unique(
  values: string[],
  label: string
): void {
  assert(
    new Set(values).size === values.length,
    `Duplicate ${label} code found in package.`
  );
}


export function versionParts(
  version: string
): number[] {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)/
  );

  return match
    ? match.slice(1).map(Number)
    : [0, 0, 0];
}


export function compareVersions(
  a: string,
  b: string
): number {
  const left = versionParts(a);
  const right = versionParts(b);

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i]! - right[i]!;
    }
  }

  return 0;
}