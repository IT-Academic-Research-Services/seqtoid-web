ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" # Set up gems listed in the Gemfile.
require 'delegate'
require "rails/command"
require "rails/commands/server/server_command"
require './lib/logging'

class IOProxy < DelegateClass(IO)
  def initialize(default_stream, threadlocal_key)
    @default_stream = default_stream
    @threadlocal_key = threadlocal_key
    super(default_stream)
  end

  def write(string)
    if Thread.current[@threadlocal_key]
      Thread.current[@threadlocal_key].write(string)
    else
      @default_stream.write(string)
    end
  end

  def puts(*args)
    if Thread.current[@threadlocal_key]
      Thread.current[@threadlocal_key].puts(*args)
    else
      @default_stream.puts(*args)
    end
  end

  def flush
    if Thread.current[@threadlocal_key]
      Thread.current[@threadlocal_key].flush
    else
      @default_stream.flush
    end
  end
end

# Permanently replace stdout and stderr with a proxies that can have their destination overridden by a ThreadLocal IO
$stdout = IOProxy.new($stdout, :stdout_proxy)
$stderr = IOProxy.new($stderr, :stderr_proxy)

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
