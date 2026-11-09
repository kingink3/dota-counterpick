package app;

import java.util.List;
import java.util.regex.Pattern;
import skadistats.clarity.event.Insert;
import skadistats.clarity.model.Entity;
import skadistats.clarity.processor.entities.Entities;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.processor.stringtables.StringTables;
import skadistats.clarity.processor.stringtables.UsesStringTable;
import skadistats.clarity.source.MappedFileSource;

/** Temporary: prints the property names we need, from one replay (ADR-055). */
@UsesEntities
@UsesStringTable("EntityNames")
public class Probe {
  static final Pattern KEEP = Pattern.compile("(?i)GameStartTime|GameEndTime|health|mana|visib|lifestate|hitems|charges|playerid|gold|gametime|gamestart|replicat|nameStringable|cellx|celly|vecorigin|selectedhero|teamnum|level|cooldown|neutral");
  boolean done;
  @Insert private Context ctx;
  @Insert private Entities es;
  @Insert private StringTables tables;

  boolean rulesShown;
  static Object get(Entity e, String p) {
    return e != null && e.hasProperty(p) ? e.getProperty(p) : null;
  }

  Entity one(String dt) {
    return es.stream().filter(Entities.byDtName(dt)).findFirst().orElse(null);
  }

  void dump(String what, Entity e) {
    if (e == null) { System.out.println("== " + what + ": none"); return; }
    System.out.println("== " + what + " " + e.getDtClass().getDtName());
    for (String line : e.toString().split("\n")) if (KEEP.matcher(line).find()) System.out.println(line);
  }

  @OnTickEnd
  public void onTickEnd(boolean synthetic) {
    if (done) return;
    Entity rules = one("CDOTAGamerulesProxy");
    if (rules == null) return;
    if (ctx.getTick() < 30 * 60 * 30) return; // ~30 min into the file: past the horn
    done = true;
    System.out.println("tick " + ctx.getTick() + " -> game time " + (ctx.getTick() / 30f - (Float) get(rules, "m_pGameRules.m_flGameStartTime")));
    dump("rules", rules);
    List<Entity> heroes = es.stream().filter(e -> e.getDtClass().getDtName().startsWith("CDOTA_Unit_Hero_")).toList();
    int n = 0;
    for (Entity h : heroes) {
      if (n++ == 0) dump("hero", h);
      Integer item = (Integer) get(h, "m_hItems.0000");
      if (n == 1 && item != null) {
        Entity it = es.getByHandle(item);
        dump("item0", it);
        if (it != null) {
          Integer idx = (Integer) get(it, "m_pEntity.m_nameStringableIndex");
          System.out.println("item0 name: " + (idx == null ? null : tables.forName("EntityNames").getNameByIndex(idx)));
        }
      }
      System.out.println("hero " + h.getDtClass().getDtName() + " hp " + get(h, "m_iHealth") + " visible " + get(h, "m_iTaggedAsVisibleByTeam") + " pid " + get(h, "m_iPlayerID") + " active " + h.isActive());
    }
    dump("radiant data", one("CDOTA_DataRadiant"));
    dump("player resource", one("CDOTA_PlayerResource"));
  }

  public static void main(String[] args) throws Exception {
    new SimpleRunner(new MappedFileSource(args[0])).runWith(new Probe());
  }
}
