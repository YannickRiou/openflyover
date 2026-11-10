import json,sys
r=json.load(open(sys.argv[1]))
for case,vs in r.items():
    print('==',case)
    for k,v in vs.items():
        g=v['gapSigned']; a=v['gapAbs']
        print(f"{k:5s} gap med {g['median']:5.1f} p90 {g['p90']:5.1f} max {g['max']:5.1f} | |gap| med {a['median']:5.1f} p90 {a['p90']:5.1f} max {a['max']:5.1f} | hidApp {v['hiddenApp']:>3} dense {v['hiddenDense']:>3} minApp {v['minLineClearanceApp']:6.1f} minDense {v['minLineClearanceDense']:6.1f} | camMin {v['cameraMinClearance']:5.0f} unk {v['unknownFrames']} | {({k2:(x['n'],round(x['worst'],2)) for k2,x in v['audit'].items()})}")
