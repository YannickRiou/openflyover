import json,sys
r=json.load(open(sys.argv[1]))
for k,v in r.items():
    print(f"{k:28s} asked {v['asked']:>3} gap med {v['gapMedian']:6.1f} p90 {v['gapP90']:6.1f} max {v['gapMax']:6.1f} | hid {v['hidden']:>3}/{v['frames']} dense {v['hiddenDense']:>3} camMin {v['camMin']:6.0f} {v['audit']}")
