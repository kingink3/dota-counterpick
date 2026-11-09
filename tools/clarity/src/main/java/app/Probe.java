package app;

import java.util.ArrayList;
import java.util.List;
import skadistats.clarity.event.Insert;
import skadistats.clarity.model.Entity;
import skadistats.clarity.processor.entities.Entities;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.source.MappedFileSource;

/** Temporary (ADR-055): what m_bNPCVisibleState on the team data means. */
@UsesEntities
public class Probe {
  @Insert private Context ctx;
  @Insert private Entities es;
  int next = 40000;

  static Object get(Entity e, String p) {
    return e != null && e.hasProperty(p) ? e.getProperty(p) : null;
  }

  @OnTickEnd
  public void onTickEnd(boolean synthetic) {
    if (ctx.getTick() < next) return;
    next += 1800 * 3; // every ~3 min
    for (String dt : new String[] {"CDOTA_DataRadiant", "CDOTA_DataDire"}) {
      Entity d = es.stream().filter(Entities.byDtName(dt)).findFirst().orElse(null);
      if (d == null) continue;
      List<Integer> on = new ArrayList<>();
      int n = 0;
      for (int i = 0; i < 4096; i++) {
        Object v = get(d, String.format("m_bNPCVisibleState.%04d", i));
        if (v == null) break;
        n++;
        if (Boolean.TRUE.equals(v)) on.add(i);
      }
      System.out.println("tick " + ctx.getTick() + " " + dt + " size " + n + " true " + on);
    }
    StringBuilder hs = new StringBuilder();
    es.stream().filter(e -> e.getDtClass().getDtName().startsWith("CDOTA_Unit_Hero_")).forEach(h ->
        hs.append(h.getDtClass().getDtName().substring(16)).append("#").append(h.getIndex()).append(" pid").append(get(h, "m_iPlayerID"))
          .append(" team").append(get(h, "m_iTeamNum")).append(" cell ").append(get(h, "CBodyComponent.m_cellX")).append(",").append(get(h, "CBodyComponent.m_cellY")).append("; "));
    System.out.println("heroes " + hs);
  }

  public static void main(String[] args) throws Exception {
    new SimpleRunner(new MappedFileSource(args[0])).runWith(new Probe());
  }
}
