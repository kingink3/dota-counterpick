package app;

import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import skadistats.clarity.event.Insert;
import skadistats.clarity.model.Entity;
import skadistats.clarity.model.StringTable;
import skadistats.clarity.processor.entities.Entities;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.processor.stringtables.StringTables;
import skadistats.clarity.processor.stringtables.UsesStringTable;
import skadistats.clarity.source.MappedFileSource;

/**
 * ADR-055: what odota/parser does not give, once per game second for each of the 10 heroes:
 * HP, mana, reliable / unreliable gold, the items in the 6 main slots, the backpack and the
 * neutral slot (with charges). One JSON object per line on stdout:
 *   {"t":<game s>,"s":<slot 0-9>,"hp","mhp","mp","mmp","rg","ug","it":[names],"ch":[charges]}
 * Field names checked on a 7.41 replay with a probe (fields differ between patches).
 */
@UsesEntities
@UsesStringTable("EntityNames")
public class Extract {
  static final int NONE = 16777215;
  /** main 0-5, backpack 6-8, neutral 16. */
  static final int[] SLOTS = {0, 1, 2, 3, 4, 5, 6, 7, 8, 16};
  @Insert private Context ctx;
  @Insert private Entities es;
  @Insert private StringTables tables;
  final BufferedWriter out = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), 1 << 16);
  int last = Integer.MIN_VALUE;
  Entity rules, radiant, dire;

  static Object get(Entity e, String p) {
    return e != null && e.hasProperty(p) ? e.getProperty(p) : null;
  }
  static int num(Entity e, String p) {
    Object v = get(e, p);
    return v instanceof Number n ? Math.round(n.floatValue()) : 0;
  }
  Entity one(String dt) {
    return es.stream().filter(Entities.byDtName(dt)).findFirst().orElse(null);
  }
  static String q(String s) {
    return s == null ? "null" : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  @OnTickEnd
  public void onTickEnd(boolean synthetic) throws Exception {
    if (rules == null) rules = one("CDOTAGamerulesProxy");
    if (rules == null) return;
    Object st = get(rules, "m_pGameRules.m_flGameStartTime");
    if (!(st instanceof Float start) || start <= 0) return;
    // game time stands still in a pause; the reader aligns the constant offset to the parser's clock
    if (Boolean.TRUE.equals(get(rules, "m_pGameRules.m_bGamePaused"))) return;
    int paused = num(rules, "m_pGameRules.m_nTotalPausedTicks");
    int t = (int) Math.floor((ctx.getTick() - paused) / 30f - start);
    if (t <= last) return;
    last = t;
    if (radiant == null) radiant = one("CDOTA_DataRadiant");
    if (dire == null) dire = one("CDOTA_DataDire");
    StringTable names = tables.forName("EntityNames");
    es.stream()
        .filter(e -> e.getDtClass().getDtName().startsWith("CDOTA_Unit_Hero_"))
        .filter(e -> num(e, "m_hReplicatingOtherHeroModel") == NONE || get(e, "m_hReplicatingOtherHeroModel") == null) // illusions
        .forEach(h -> {
          int pid = num(h, "m_iPlayerID");
          if (pid < 0 || pid > 18) return;
          int slot = pid / 2;
          // clones (Meepo, Arc Warden's double) share the player id: only the selected hero
          Entity pr = one("CDOTA_PlayerResource");
          Object sel = get(pr, String.format("m_vecPlayerTeamData.%04d.m_hSelectedHero", slot));
          if (sel instanceof Integer s && s != h.getHandle()) return;
          Entity data = slot < 5 ? radiant : dire;
          String d = String.format("m_vecDataTeam.%04d.", slot % 5);
          StringBuilder it = new StringBuilder();
          StringBuilder ch = new StringBuilder();
          for (int k : SLOTS) {
            int hd = num(h, String.format("m_hItems.%04d", k));
            Entity item = hd == NONE ? null : es.getByHandle(hd);
            String name = null;
            int charges = 0;
            if (item != null) {
              int idx = num(item, "m_pEntity.m_nameStringTableIndex");
              name = names != null && idx >= 0 ? names.getNameByIndex(idx) : null;
              charges = num(item, "m_iCurrentCharges");
            }
            if (it.length() > 0) { it.append(','); ch.append(','); }
            it.append(q(name));
            ch.append(charges);
          }
          try {
            out.write("{\"t\":" + t + ",\"s\":" + slot + ",\"lv\":" + num(h, "m_iCurrentLevel") + ",\"hp\":" + num(h, "m_iHealth") + ",\"mhp\":" + num(h, "m_iMaxHealth")
                + ",\"mp\":" + num(h, "m_flMana") + ",\"mmp\":" + num(h, "m_flMaxMana") + ",\"rg\":" + num(data, d + "m_iReliableGold")
                + ",\"ug\":" + num(data, d + "m_iUnreliableGold") + ",\"it\":[" + it + "],\"ch\":[" + ch + "]}\n");
          } catch (Exception ex) {
            throw new RuntimeException(ex);
          }
        });
  }

  public static void main(String[] args) throws Exception {
    Extract x = new Extract();
    new SimpleRunner(new MappedFileSource(args[0])).runWith(x);
    x.out.flush();
  }
}
