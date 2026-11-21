# frozen_string_literal: true

# semantic_logger version of a Silencer.
# Mostly used to silence entire request/sessions like /health_check
class SemanticLoggerSilencer
  def initialize(app, silence: [])
    @app = app
    @silence_paths = Array(silence)
  end

  def call(env)
    if silenced?(env["PATH_INFO"]) || silenced?(env["REQUEST_URI"])
      SemanticLogger.silence { @app.call(env) }
    else
      @app.call(env)
    end
  end

  private

  def silenced?(path)
    @silence_paths.any? do |rule|
      rule.is_a?(Regexp) ? rule.match?(path) : rule == path
    end
  end
end
