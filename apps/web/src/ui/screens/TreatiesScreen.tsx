import { useState } from "react";
import type { CountryId } from "@gs/shared";
import {
  canJoinOrg,
  dateAt,
  leadingMembers,
  ORG_INFO,
  ORG_KINDS,
  relation,
  relationLabel,
  TREATY_INFO,
  TREATY_TYPES,
  treatiesOf,
  partnerIn,
  tradeGrowth,
  treatyResearch,
  validateCommand,
  wouldAcceptTreaty,
  canFoundOrg,
  type GameState,
  type OrgKind,
  type Organization,
  type TreatyType,
} from "@gs/sim";
import { flagUrl, GEOGRAPHY, getCountry, landNeighbours } from "../../data/countries";
import { useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { formatDate, formatPercent } from "../format";
import { Card } from "./Screen";

const nameIn = (s: GameState, id: CountryId) => s.countries[id]?.name ?? getCountry(id)?.name ?? id;

function Flag({ id }: { id: CountryId }) {
  const info = getCountry(id);
  const url = info ? flagUrl(info) : null;
  return url ? <img className="treaty__flag" src={url} alt="" /> : <span className="flag-placeholder treaty__flag" />;
}

// ============ Treaties ============

export function TreatiesTab({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const mine = treatiesOf(s, me).sort((a, b) => nameIn(s, partnerIn(a, me)).localeCompare(nameIn(s, partnerIn(b, me))) || a.type.localeCompare(b.type));
  const proposals = s.proposals.filter((p) => p.to === me);
  const trade = tradeGrowth(s, me);
  const research = treatyResearch(s, me);
  return (
    <>
      {proposals.length > 0 && (
        <div className="list" data-testid="proposals">
          {proposals.map((p) => (
            <div key={p.id} className="offer">
              <span>
                {nameIn(s, p.from)} proposes {p.kind === "alliance" ? "an alliance" : `a ${TREATY_INFO[p.kind].label.toLowerCase()}`}.
              </span>
              <button className="btn btn--primary btn--small" onClick={() => send({ type: "answerProposal", country: me, proposalId: p.id, accept: true })}>
                Accept
              </button>
              <button className="btn btn--ghost btn--small" onClick={() => send({ type: "answerProposal", country: me, proposalId: p.id, accept: false })}>
                No
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid">
        <Card title={`Your treaties (${mine.length})`} hint="Agreements with one other country. Either side can cancel, which hurts relations." wide>
          {mine.length ? (
            <table className="table" data-testid="my-treaties">
              <tbody>
                {mine.map((t) => {
                  const other = partnerIn(t, me);
                  return (
                    <tr key={t.id}>
                      <td>
                        <Flag id={other} /> {nameIn(s, other)}
                      </td>
                      <td title={TREATY_INFO[t.type].effect}>{TREATY_INFO[t.type].label}</td>
                      <td className="treaty__since">since {formatDate(dateAt(s.startDate, t.since))}</td>
                      <td className="num">
                        <button
                          className="btn btn--ghost btn--small"
                          title={`Relations with ${nameIn(s, other)} drop by ${TREATY_INFO[t.type].cancelPenalty}.`}
                          onClick={() => send({ type: "cancelTreaty", country: me, target: other, treaty: t.type })}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="screen__note">No treaties yet. Pick a country below to propose one.</p>
          )}
          <p className="screen__note">
            Trade adds {formatPercent(trade, 2, true)} a year to your growth (up to +0.50%); research agreements speed up research by {formatPercent(research, 0, true)}.
          </p>
        </Card>
      </div>
      <SignTreaty me={me} />
    </>
  );
}

function SignTreaty({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const provinces = useGame((x) => x.provincesOf.get(me)) ?? [];
  const target = useUi((x) => x.diplomacyTarget);
  const setTarget = useUi((x) => x.setDiplomacyTarget);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const neighbours = new Set(landNeighbours(s, provinces));
  const choices = Object.values(s.countries)
    .filter((c) => c.active && c.id !== me)
    .filter((c) => (q ? c.name.toLowerCase().includes(q) : neighbours.has(c.id) || relation(s, me, c.id) >= 20))
    .sort((a, b) => relation(s, me, b.id) - relation(s, me, a.id))
    .slice(0, 12);
  const them = target && target !== me && s.countries[target]?.active ? target : null;
  return (
    <Card title="Propose a treaty" hint="Computer-run countries answer at once; another player gets your proposal and has two months to answer." wide>
      {!them ? (
        <>
          <input className="input screen__search" placeholder="Find a country…" aria-label="Find a country for a treaty" value={query} onChange={(e) => setQuery(e.target.value)} />
          <p className="screen__note">{q ? `Countries matching "${query}".` : "Your neighbours and friends. Search to find any other country."}</p>
          <div className="treaty__choices">
            {choices.map((c) => (
              <button key={c.id} className="btn btn--ghost btn--small" onClick={() => setTarget(c.id)} data-testid={`treaty-pick-${c.id}`}>
                <Flag id={c.id} /> {c.name} <span className="treaty__rel">{relationLabel(relation(s, me, c.id))}</span>
              </button>
            ))}
            {!choices.length && <p className="screen__note">No countries found.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="treaty__target">
            <Flag id={them} />
            <strong>{nameIn(s, them)}</strong>
            <span>
              Relations {Math.round(relation(s, me, them))} ({relationLabel(relation(s, me, them))})
            </span>
            <button className="btn btn--ghost btn--small" onClick={() => setTarget(null)}>
              Pick another country
            </button>
          </div>
          <table className="table" data-testid="treaty-options">
            <tbody>
              {TREATY_TYPES.map((type) => (
                <TreatyRow key={type} me={me} them={them} type={type} onPropose={() => send({ type: "proposeTreaty", country: me, target: them, treaty: type })} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

function TreatyRow({ me, them, type, onPropose }: { me: CountryId; them: CountryId; type: TreatyType; onPropose: () => void }) {
  const s = useGame((x) => x.state);
  const info = TREATY_INFO[type];
  const blocked = validateCommand(s, GEOGRAPHY, { type: "proposeTreaty", country: me, target: them, treaty: type });
  const ai = s.countries[them]?.controller === "ai";
  const refuse = !blocked && ai ? wouldAcceptTreaty(s, me, them, type) : null;
  const status = blocked ?? (refuse ? `They'd say no: ${refuse}` : ai ? "They'd accept." : "They decide (another player).");
  return (
    <tr>
      <td>
        <strong>{info.label}</strong>
        <div className="panel__small">{info.effect}</div>
      </td>
      <td className={`treaty__status ${blocked || refuse ? "neg" : "pos"}`}>{status}</td>
      <td className="num">
        <button className="btn btn--primary btn--small" disabled={!!blocked || !!refuse} title={blocked ?? refuse ?? undefined} onClick={onPropose} data-testid={`propose-${type}`}>
          Propose
        </button>
      </td>
    </tr>
  );
}

// ============ Organizations ============

const KIND_LABEL: Record<OrgKind, string> = { economic: "Economic union", defense: "Defense alliance", political: "Political union" };

export function OrganizationsTab({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const orgs = useGame((x) => x.state.organizations);
  const mine = orgs.filter((o) => o.members.includes(me));
  const others = orgs.filter((o) => !o.members.includes(me) && o.members.length).sort((a, b) => b.members.length - a.members.length);
  return (
    <>
      <div className="grid">
        <Card title={`Your organizations (${mine.length})`} hint="Groups of countries. Economic unions count as trade agreements between every member; defense alliances defend each other; political unions bring members closer." wide>
          {mine.length ? <OrgList s={s} me={me} orgs={mine} /> : <p className="screen__note">You're not in any organization. Join one below, or found your own.</p>}
        </Card>
        <Card title="Other organizations" hint="The three largest economies among the members decide who may join." wide>
          {others.length ? <OrgList s={s} me={me} orgs={others} /> : <p className="screen__note">There are no other organizations.</p>}
        </Card>
      </div>
      <FoundOrg me={me} />
      <p className="screen__note">
        Real organizations and their members at the start of the scenario come from Wikidata (CC0). What each kind does in the game is a game rule.
      </p>
    </>
  );
}

function OrgList({ s, me, orgs }: { s: GameState; me: CountryId; orgs: Organization[] }) {
  const send = useGame((x) => x.send);
  const [open, setOpen] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  return (
    <div className="list">
      {orgs.map((o) => {
        const member = o.members.includes(me);
        const why = member ? null : canJoinOrg(s, me, o);
        return (
          <div key={o.id} className="org" data-testid={`org-${o.id}`}>
            <div className="org__head">
              <strong>{o.name}</strong>
              <span className={`org__kind org__kind--${o.kind}`}>{KIND_LABEL[o.kind]}</span>
              <span className="org__count">
                {o.members.length} member{o.members.length === 1 ? "" : "s"}
                {o.source === "game" ? ` · founded ${formatDate(dateAt(s.startDate, o.since))}` : ""}
              </span>
            </div>
            <p className="panel__small">
              {ORG_INFO[o.kind].effect} Led by {leadingMembers(s, o).map((m) => nameIn(s, m)).join(", ") || "nobody"}.
            </p>
            {open === o.id && (
              <p className="org__members">
                {o.members
                  .map((m) => nameIn(s, m))
                  .sort()
                  .join(", ")}
              </p>
            )}
            <div className="org__actions">
              <button className="btn btn--ghost btn--small" onClick={() => setOpen(open === o.id ? null : o.id)}>
                {open === o.id ? "Hide members" : "Show members"}
              </button>
              {member ? (
                leaving === o.id ? (
                  <span className="confirm">
                    Leave {o.name}? Relations with its members drop by {ORG_INFO[o.kind].leavePenalty}.
                    <button
                      className="btn btn--danger btn--small"
                      onClick={() => {
                        send({ type: "leaveOrganization", country: me, org: o.id });
                        setLeaving(null);
                      }}
                    >
                      Yes, leave
                    </button>
                    <button className="btn btn--ghost btn--small" onClick={() => setLeaving(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className="btn btn--ghost btn--small" onClick={() => setLeaving(o.id)}>
                    Leave
                  </button>
                )
              ) : (
                <button className="btn btn--primary btn--small" disabled={!!why} title={why ?? `Join ${o.name}.`} onClick={() => send({ type: "joinOrganization", country: me, org: o.id })} data-testid={`join-${o.id}`}>
                  Join
                </button>
              )}
            </div>
            {why && <p className="panel__small">{why}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FoundOrg({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrgKind>("economic");
  const why = canFoundOrg(s, me, name, kind);
  return (
    <Card title="Found an organization" hint="You start as its only member; others can join if they get on with you." wide>
      <div className="org__found">
        <input className="input" placeholder="Name, e.g. Northern Trade Union" aria-label="Organization name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" aria-label="Kind of organization" value={kind} onChange={(e) => setKind(e.target.value as OrgKind)}>
          {ORG_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button
          className="btn btn--primary btn--small"
          disabled={!!why}
          title={why ?? undefined}
          onClick={() => {
            send({ type: "foundOrganization", country: me, name, kind });
            setName("");
          }}
        >
          Found
        </button>
      </div>
      <p className="panel__small">{name.trim() && why ? why : ORG_INFO[kind].effect}</p>
    </Card>
  );
}
