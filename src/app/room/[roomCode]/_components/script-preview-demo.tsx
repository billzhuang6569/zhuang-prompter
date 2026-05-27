import { extensionSpecFixture, parseMarkdown } from "@/modules/script-engine";
import { RenderBundleView } from "./render-bundle-view";

type ScriptPreviewDemoProps = {
  variant: "control" | "player";
};

export function ScriptPreviewDemo({ variant }: ScriptPreviewDemoProps) {
  const bundle = parseMarkdown(extensionSpecFixture, { scriptVersionId: "fixture_m1" });

  return <RenderBundleView bundle={bundle} variant={variant} />;
}
