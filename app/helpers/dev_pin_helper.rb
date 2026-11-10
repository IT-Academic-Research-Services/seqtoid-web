# App-wide "dev is pinned" banner (deploy lanes). The Helm chart sets these env vars on the web pods only
# when the Argo-layered dev-pin values file has pin.kind lease or rc (see deploy/charts/seqtoid-web
# values.yaml `pin`):
#   DEV_PIN_KIND        lease | rc
#   DEV_PIN_HOLDER      who holds the lease (lease)
#   DEV_PIN_EXPIRES_AT  ISO-8601 time the lease ends (lease)
#   DEV_PIN_RC          release-candidate name (rc)
# Without DEV_PIN_KIND (every env except a pinned dev) nothing renders.
module DevPinHelper
  DevPinBanner = Struct.new(:kind, :holder, :expires_at, :rc, keyword_init: true)

  def dev_pin_banner
    case ENV["DEV_PIN_KIND"].to_s.strip.downcase
    when "lease"
      DevPinBanner.new(
        kind: "lease",
        holder: ENV["DEV_PIN_HOLDER"].to_s.strip.presence || "someone",
        expires_at: parse_dev_pin_time(ENV["DEV_PIN_EXPIRES_AT"])
      )
    when "rc"
      DevPinBanner.new(kind: "rc", rc: ENV["DEV_PIN_RC"].to_s.strip.presence || "an unnamed build")
    end
  end

  private

  def parse_dev_pin_time(value)
    Time.iso8601(value.to_s.strip).utc
  rescue ArgumentError
    nil
  end
end
