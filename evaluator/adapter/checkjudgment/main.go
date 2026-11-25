// checkjudgment runs the adapter kit's package check (the node's Stage 1 parser) for a family that the
// kit's compiled-in catalog does not list yet.
//
// The kit ships an offline copy of the intent catalog. WEATHER_FORECAST is not in that copy, so
// `adapterbuild lora --intent WEATHER_FORECAST` refuses to guess its class. The live node is the
// authority and says judgment:
//
//	curl -s https://devnode.telegraphprotocol.com/engine/v1/intents/WEATHER_FORECAST_GENERAL | jq .class
//
// This tool tells the checker what the node says (catalog.UseClasses, the kit's own hook for tools) and
// then runs the same check, unchanged. Copy this folder into the kit's cmd/ directory to build it:
//
//	go run ./cmd/checkjudgment --intent WEATHER_FORECAST --package <file.safetensors> --foundation foundation/foundation.json
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/telegraphprotocol/telegraph-wasm-baseline/pkg/adapterbuild"
	"github.com/telegraphprotocol/telegraph-wasm-baseline/pkg/scoring/catalog"
)

func main() {
	intent := flag.String("intent", "", "family prefix, e.g. WEATHER_FORECAST")
	pkg := flag.String("package", "", "the safetensors delta package")
	foundation := flag.String("foundation", "", "foundation.json")
	out := flag.String("out", "", "directory for the manifest")
	model := flag.String("foundation-onnx", "", "optional: the foundation graph, to score the default input")
	engine := flag.String("engine", "", "optional: the foundation engine wasm (with --foundation-onnx)")
	flag.Parse()
	catalog.UseClasses(map[string]catalog.Class{*intent: catalog.ClassJudgment, *intent + "_GENERAL": catalog.ClassJudgment})
	logf := func(format string, a ...any) { fmt.Fprintf(os.Stderr, "checkjudgment: "+format+"\n", a...) }
	art, man, err := adapterbuild.CheckLoRA(context.Background(), adapterbuild.LoRAReq{
		Intent: *intent, PackagePath: *pkg, Class: "judgment", FoundationPath: *foundation, OutDir: *out,
		ModelPath: *model, EnginePath: *engine,
	}, logf)
	if err != nil {
		fmt.Fprintf(os.Stderr, "checkjudgment: FAILED: %v\n", err)
		os.Exit(1)
	}
	b, _ := json.Marshal(map[string]any{"intent": *intent, "class": man.Class, "keccak256": art.Keccak256, "sha256": art.SHA256, "bytes": art.Bytes, "manifest": art.ManifestPath})
	fmt.Println(string(b))
}
