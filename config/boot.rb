ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" # Set up gems listed in the Gemfile.
require "rails/command"
require "rails/commands/server/server_command"
require './lib/logging'

module Rails
  module Command
    class ServerCommand < Base
      # Override Thor's instance method 'say' (lib/thor/shell.rb:59)
      def say(message = "", color = nil, force_new_line = true)
        # Cannot use Rails.Logger because it isn't initialized yet
        data = Logging.reduce_filters({ msg: message.strip, module: "boot" })
        if data
          message = Logging.default_formatter.call(:debug, Time.current, nil, data).strip
          super(message, color, force_new_line)
        end
      end
    end
  end
end
